// End-to-end business-rule tests against a throwaway database.
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irms-test-'));
process.env.IRMS_DATA_DIR = dir;
const { app } = await import('../index.js');
const { today, addDays } = await import('../lib.js');

let server; let base;
const tokens = {};
before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
  for (const u of ['admin', 'cashier', 'fosup', 'marketing', 'restaurant', 'hk', 'hksup']) {
    const r = await call('POST', '/auth/login', { username: u, password: u === 'admin' ? 'admin123' : `${u}123` }, null);
    tokens[u] = r.body.token;
  }
});
after(async () => {
  server.close();
  (await import('../db.js')).db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold the WAL file briefly */ }
});

async function call(method, url, body, who = 'cashier') {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const ok = (r) => { assert.ok(r.status < 300, `${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const T = today();
const roomId = async (no) => (ok(await call('GET', '/rooms', null))).rooms.find((r) => r.room_no === no).id;

test('reservation blocks rooms, amend revalidates, cancel releases', async () => {
  const vr101 = await roomId('VR101');
  const r1 = ok(await call('POST', '/reservations', {
    guest: { full_name: 'Dela Cruz, Juan', contact_no: '0917 000 0000' }, source: 'Phone call',
    check_in: addDays(T, 5), check_out: addDays(T, 7), lines: [{ room_id: vr101, adults: 2 }],
  }, 'marketing'));
  assert.equal(r1.reservation.reservation_status, 'Active / Booked');
  assert.equal(r1.reservation.payment_status, 'Unpaid');
  assert.equal(r1.totals.total, 1200000);
  assert.equal(r1.totals.downPaymentRequired, 360000);
  // Overlapping booking on the same room is refused (FO-RSV-02/03)
  const clash = await call('POST', '/reservations', { guest: { full_name: 'X', contact_no: '1' }, source: 'Website', check_in: addDays(T, 6), check_out: addDays(T, 8), lines: [{ room_id: vr101, adults: 1 }] });
  assert.equal(clash.status, 409);
  // Down payment -> Partially Paid
  const p = ok(await call('POST', `/reservations/${r1.reservation.id}/payments`, { tenders: [{ method: 'GCash', amount: 360000, reference: 'GC-1' }] }));
  assert.equal(p.reservation.payment_status, 'Partially Paid');
  assert.ok(p.payment.receipt.receipt_no);
  // Over-collection blocked
  assert.equal((await call('POST', `/reservations/${r1.reservation.id}/payments`, { tenders: [{ method: 'Cash', amount: 9999999 }] })).status, 400);
  // Cancel: never delete, room released, refund pending
  const c = ok(await call('POST', `/reservations/${r1.reservation.id}/cancel`, { reason: 'Guest changed plans' }, 'marketing'));
  assert.equal(c.reservation.reservation_status, 'Cancelled');
  assert.equal(c.reservation.payment_status, 'Refund Pending');
  ok(await call('POST', '/reservations', { guest: { full_name: 'Y', contact_no: '1' }, source: 'Website', check_in: addDays(T, 6), check_out: addDays(T, 8), lines: [{ room_id: vr101, adults: 1 }] }));
  // Refund needs supervisor approval
  assert.equal((await call('POST', `/reservations/${c.reservation.id}/refund-decision`, { decision: 'No Refund', reason: 'Policy' })).status, 403);
  const rd = ok(await call('POST', `/reservations/${c.reservation.id}/refund-decision`, { decision: 'Refund Completed', amount: 360000, method: 'GCash', reason: 'Approved', approval: { username: 'fosup', password: 'fosup123' } }));
  assert.equal(rd.reservation.payment_status, 'Refund Completed');
  assert.equal(rd.totals.paid, 0);
});

let multi;
test('multi-room check-in: gate, per-room check-in, transfer, dept charges, checkout', async () => {
  const [a, b, c] = [await roomId('VR102'), await roomId('VR103'), await roomId('DX201')];
  multi = ok(await call('POST', '/reservations', {
    guest: { full_name: 'Santos, Maria', contact_no: '0917' }, source: 'Walk-in', check_in: T, check_out: addDays(T, 2),
    lines: [{ room_id: a, adults: 2, children: 1 }, { room_id: b, adults: 2 }, { room_id: c, adults: 2 }],
  }));
  const id = multi.reservation.id;
  assert.equal(multi.totals.total, (600000 + 600000 + 850000) * 2);
  const [l1, l2, l3] = multi.lines;
  // Gate refuses without ID/form/readiness/balance
  let g = await call('POST', `/reservations/${id}/checkin`, { line_ids: [l1.id] });
  assert.equal(g.status, 422);
  assert.ok(g.body.failures.length >= 3);
  ok(await call('POST', `/reservations/${id}/id-verify`, { id_type: "Driver's license", verified: true }));
  ok(await call('POST', `/reservations/${id}/signed-form`, { line_ids: [l1.id, l2.id], paper_on_file: true }));
  ok(await call('POST', `/reservations/${id}/lines/${l1.id}/hk-confirm`, {}));
  ok(await call('POST', `/reservations/${id}/lines/${l2.id}/hk-confirm`, {}));
  // DX201 dirty -> cannot confirm readiness
  ok(await call('POST', `/rooms/${c}/hk-status`, { to: 'Dirty' }, 'hk'));
  assert.equal((await call('POST', `/reservations/${id}/lines/${l3.id}/hk-confirm`, {})).status, 409);
  // Split tender payment of outstanding
  const out = ok(await call('GET', `/reservations/${id}`)).totals.outstanding;
  ok(await call('POST', `/reservations/${id}/payments`, { tenders: [{ method: 'Cash', amount: 1000000 }, { method: 'Bank Transfer', amount: out - 1000000, reference: 'BT-0042' }] }));
  const d = ok(await call('POST', `/reservations/${id}/checkin`, { line_ids: [l1.id, l2.id] }));
  assert.equal(d.reservation.reservation_status, 'Active / Booked', 'RM-01 default: stays Active until last room');
  assert.equal(d.lines[0].line_status, 'Checked In');
  assert.equal(d.lines[2].line_status, 'Active');
  // Paid upgrade VR102 -> FM301 (guest request)
  const fm = await roomId('FM301');
  const opts = ok(await call('GET', `/reservations/${id}/lines/${l1.id}/transfer-options`));
  assert.ok(opts.rooms.find((r) => r.id === fm).selectable);
  const nights = opts.window.nights;
  const value = (1000000 - 600000) * nights;
  assert.equal((await call('POST', `/reservations/${id}/lines/${l1.id}/transfer`, { to_room_id: fm, reason_type: 'guest', reason: 'Wants a larger room', tenders: [{ method: 'GCash', amount: value - 1 }] })).status, 400);
  const tr = ok(await call('POST', `/reservations/${id}/lines/${l1.id}/transfer`, { to_room_id: fm, reason_type: 'guest', reason: 'Wants a larger room', tenders: [{ method: 'GCash', amount: value }] }));
  assert.equal(tr.lines[0].room_no, 'FM301');
  assert.equal(tr.totals.outstanding, 0);
  const rooms = ok(await call('GET', '/rooms')).rooms;
  assert.equal(rooms.find((r) => r.room_no === 'VR102').hk_status, 'Dirty');
  assert.equal(rooms.find((r) => r.room_no === 'FM301').availability, 'Occupied');
  // Free upgrade (fault) VR103 -> DX202 requires approval; original room blocked
  const dx2 = await roomId('DX202');
  const body2 = { to_room_id: dx2, reason_type: 'fault', reason: 'Aircon not working' };
  assert.equal((await call('POST', `/reservations/${id}/lines/${l2.id}/transfer`, body2)).status, 403);
  // Part 2 Fig. 2: Request Approval -> PENDING -> supervisor approves -> Confirm Transfer unlocks
  const req1 = ok(await call('POST', '/approvals', { type: 'transfer_waiver', entity: 'reservation', entity_id: id, payload: { line_id: l2.id, to_room_id: dx2 }, summary: 'VR103 > DX202 free upgrade', reason: 'Aircon not working' }));
  assert.equal(req1.approval.status, 'Pending');
  assert.equal((await call('POST', `/reservations/${id}/lines/${l2.id}/transfer`, { ...body2, approval_id: req1.approval.id })).status, 403, 'pending approval keeps Confirm locked');
  assert.equal((await call('POST', `/approvals/${req1.approval.id}/approve`, {})).status, 403, 'cashier cannot approve');
  ok(await call('POST', `/approvals/${req1.approval.id}/approve`, {}, 'fosup'));
  // approval is for DX202 only
  assert.equal((await call('POST', `/reservations/${id}/lines/${l2.id}/transfer`, { ...body2, to_room_id: await roomId('DX203'), approval_id: req1.approval.id })).status, 403);
  const tr2 = ok(await call('POST', `/reservations/${id}/lines/${l2.id}/transfer`, { ...body2, approval_id: req1.approval.id }));
  assert.equal(tr2.transfers[1].waived_by, 'fosup');
  assert.equal(tr2.transfers[1].treatment, 'Free upgrade (fault on resort side)');
  assert.equal(tr2.totals.outstanding, 0);
  assert.equal(ok(await call('GET', '/rooms')).rooms.find((r) => r.room_no === 'VR103').block_status, 'Under Repair / Blocked');
  // Restaurant Charge to Room is idempotent
  const dept = { department: 'Restaurant', method: 'charge', target: { type: 'room', room_no: 'FM301' }, items: [{ name: 'Pork Sinigang', qty: 1, price: 45000 }], source_txn_id: 'EXT-1' };
  ok(await call('POST', '/department/transactions', dept, 'restaurant'));
  const again = ok(await call('POST', '/department/transactions', dept, 'restaurant'));
  assert.equal(again.duplicate, true);
  // Direct payment does not touch the folio
  ok(await call('POST', '/department/transactions', { method: 'direct', direct_tender: 'Cash', items: [{ name: 'Iced Tea', qty: 2, price: 15000 }] }, 'restaurant'));
  const f = ok(await call('GET', `/reservations/${id}`));
  assert.equal(f.totals.dept, 45000);
  assert.equal(f.totals.outstanding, 45000);
  // Checkout blocked until balance paid
  const both = f.lines.filter((l) => l.line_status === 'Checked In').map((l) => l.id);
  assert.equal((await call('POST', `/reservations/${id}/checkout`, { line_ids: both })).status, 422);
});

test('housekeeping: checkout -> Dirty; inspection rule for repaired rooms', async () => {
  const vr103 = await roomId('VR103');
  // Release needs defects resolved
  assert.equal((await call('POST', `/rooms/${vr103}/release`, {}, 'hksup')).status, 400);
  const defects = ok(await call('GET', '/rooms/defects/list', null, 'hksup')).defects.filter((d) => d.room_no === 'VR103');
  for (const d of defects) ok(await call('POST', `/rooms/defects/${d.id}/resolve`, { resolution: 'Aircon fixed' }, 'hksup'));
  ok(await call('POST', `/rooms/${vr103}/release`, {}, 'hksup'));
  // needs inspection: Clean directly is refused
  ok(await call('POST', `/rooms/${vr103}/hk-status`, { to: 'Cleaning In Progress' }, 'hk'));
  assert.equal((await call('POST', `/rooms/${vr103}/hk-status`, { to: 'Clean' }, 'hk')).status, 400);
  ok(await call('POST', `/rooms/${vr103}/hk-status`, { to: 'For Inspection' }, 'hk'));
  assert.equal((await call('POST', `/rooms/${vr103}/hk-status`, { to: 'Clean' }, 'hk')).status, 400);
  ok(await call('POST', `/rooms/${vr103}/hk-status`, { to: 'Clean' }, 'hksup'));
  const room = ok(await call('GET', '/rooms')).rooms.find((r) => r.room_no === 'VR103');
  assert.equal(room.availability, 'Available');
});

test('day tour: group, entry gate, lockers, charge to locker, settlement, lost key, checkout', async () => {
  const g = ok(await call('POST', '/daytour/groups', { booking_type: 'Walk-in', group_name: 'GROUP 1 - JAMES BOND', contact_no: '0917', estimated_guests: 15 }));
  const id = g.group.id;
  const a = ok(await call('POST', `/daytour/groups/${id}/counts`, { counts: { ADULT: 8, CHILD: 2, SENIOR: 3, PWD: 1, PET: 0 } }));
  assert.equal(a.group.actual_guests, 14);
  assert.equal(a.group.group_status, 'Arrived / Active');
  assert.equal(a.totals.entrance, 660000);
  ok(await call('POST', `/daytour/groups/${id}/facilities`, { code: 'KUBO', qty: 1 }));
  // Key issue locked until entry paid
  assert.equal((await call('POST', `/daytour/groups/${id}/lockers`, { locker_id: 'RED-015', occupants: '1 Adult' })).status, 409);
  ok(await call('POST', `/daytour/groups/${id}/payments`, { tenders: [{ method: 'Cash', amount: 810000 }] }));
  const l1 = ok(await call('POST', `/daytour/groups/${id}/lockers`, { locker_id: 'RED-015', occupants: '1 Adult' }));
  ok(await call('POST', `/daytour/groups/${id}/lockers`, { locker_id: 'RED-016', assignment_type: 'Shared', occupants: '2 Adults, 1 Child' }));
  ok(await call('POST', `/daytour/groups/${id}/lockers`, { locker_id: 'BLUE-102', occupants: '1 Adult' }));
  // RED-102 and BLUE-102 are different lockers; BLUE-102 cannot be reassigned
  assert.equal((await call('POST', `/daytour/groups/${id}/lockers`, { locker_id: 'BLUE-102', occupants: 'x' })).status, 409);
  ok(await call('POST', '/department/transactions', { department: 'Restaurant', method: 'charge', target: { type: 'locker', locker_id: 'RED-015' }, items: [{ name: 'Meal', qty: 1, price: 85000 }] }, 'restaurant'));
  ok(await call('POST', '/department/transactions', { department: 'Mini Bar', method: 'charge', target: { type: 'locker', locker_id: 'BLUE-102' }, items: [{ name: 'Drinks', qty: 1, price: 90000 }] }, 'admin'));
  let d = ok(await call('GET', `/daytour/groups/${id}`));
  assert.equal(d.totals.outstanding, 175000, 'group = sum of lockers, no double counting');
  const red15 = d.accounts.find((x) => x.locker_id === 'RED-015');
  const blue = d.accounts.find((x) => x.locker_id === 'BLUE-102');
  const red16 = d.accounts.find((x) => x.locker_id === 'RED-016');
  // Return key with unpaid balance -> Key Returned - Unsettled; group Settling
  d = ok(await call('POST', `/daytour/locker-accounts/${red15.id}/return-key`, {}));
  assert.equal(d.group.group_status, 'Settling');
  assert.equal(d.accounts.find((x) => x.id === red15.id).locker_status, 'Key Returned - Unsettled');
  ok(await call('POST', `/daytour/locker-accounts/${red16.id}/return-key`, {}));
  // Representative pays both lockers in one payment, two tenders
  d = ok(await call('POST', `/daytour/groups/${id}/payments`, {
    tenders: [{ method: 'Cash', amount: 100000 }, { method: 'GCash', amount: 75000, reference: 'GC-0207' }],
    allocations: [{ target_type: 'locker_account', target_id: red15.id, amount: 85000 }, { target_type: 'locker_account', target_id: blue.id, amount: 90000 }],
  }));
  assert.equal(d.totals.outstanding, 0);
  assert.equal(ok(await call('GET', '/daytour/lockers/search?color=Red&number=15')).locker.locker_status, 'Available after clearance');
  // BLUE-102 key missing blocks checkout
  assert.equal((await call('POST', `/daytour/groups/${id}/checkout`, {})).status, 422);
  assert.equal((await call('POST', `/daytour/locker-accounts/${blue.id}/lost-key`, { penalty: 20000, note: 'Key not returned' })).status, 400);
  ok(await call('POST', `/daytour/locker-accounts/${blue.id}/lost-key`, { penalty: 50000, note: 'Key not returned' }));
  assert.equal((await call('POST', `/daytour/groups/${id}/checkout`, {})).status, 422);
  ok(await call('POST', `/daytour/groups/${id}/payments`, { tenders: [{ method: 'Cash', amount: 50000 }], allocations: [{ target_type: 'locker_account', target_id: blue.id, amount: 50000 }] }));
  d = ok(await call('POST', `/daytour/groups/${id}/checkout`, {}));
  assert.equal(d.group.group_status, 'Checked Out');
  assert.equal(ok(await call('GET', '/daytour/lockers/search?color=Blue&number=102')).locker.locker_status, 'Lost');
  // Receipt data shows department source IDs
  const pay = d.payments[1];
  const rc = ok(await call('GET', `/payments/${pay.id}/receipt`));
  assert.ok(rc.lines[0].sub.some((s) => /RST-/.test(s.label)));
});

test('role access is enforced', async () => {
  assert.equal((await call('POST', `/reservations/${multi.reservation.id}/checkin`, { line_ids: [1] }, 'marketing')).status, 403);
  assert.equal((await call('POST', '/department/transactions', { department: 'Massage', method: 'direct', direct_tender: 'Cash', items: [{ name: 'x', qty: 1, price: 100 }] }, 'restaurant')).status, 400);
  assert.equal((await call('GET', '/admin/users', null, 'cashier')).status, 403);
});

test('amend: change dates/rooms; failed change keeps the original rooms', async () => {
  const [a, b] = [await roomId('VR105'), await roomId('VR106')];
  const r = ok(await call('POST', '/reservations', { guest: { full_name: 'Amend, Test', contact_no: '1' }, source: 'Website', check_in: addDays(T, 10), check_out: addDays(T, 12), lines: [{ room_id: a, adults: 2 }] }, 'marketing'));
  const other = ok(await call('POST', '/reservations', { guest: { full_name: 'Other', contact_no: '1' }, source: 'Website', check_in: addDays(T, 12), check_out: addDays(T, 14), lines: [{ room_id: b, adults: 1 }] }));
  // Extend + add VR106 overlapping the other booking -> refused, original unchanged
  const bad = await call('PUT', `/reservations/${r.reservation.id}`, { check_in: addDays(T, 10), check_out: addDays(T, 13), lines: [{ id: r.lines[0].id, room_id: a, adults: 2 }, { room_id: b, adults: 2 }] }, 'marketing');
  assert.equal(bad.status, 409);
  let d = ok(await call('GET', `/reservations/${r.reservation.id}`));
  assert.equal(d.reservation.check_out, addDays(T, 12));
  assert.equal(d.lines.filter((l) => l.line_status === 'Active').length, 1);
  // Valid change: extend 1 night, swap room to VR107
  const c = await roomId('VR107');
  d = ok(await call('PUT', `/reservations/${r.reservation.id}`, { check_in: addDays(T, 10), check_out: addDays(T, 13), reason: 'Extend', lines: [{ id: r.lines[0].id, room_id: c, adults: 3 }] }, 'marketing'));
  assert.equal(d.totals.room, 600000 * 3);
  assert.equal(d.lines[0].room_no, 'VR107');
  // VR105 is released for those dates
  ok(await call('POST', '/reservations', { guest: { full_name: 'Z', contact_no: '1' }, source: 'Website', check_in: addDays(T, 10), check_out: addDays(T, 12), lines: [{ room_id: a, adults: 1 }] }));
  assert.ok(d.history.some((h) => h.action === 'reservation.amend'));
  void other;
});

test('cutover opening record: in-house guest with WinCloud balance', async () => {
  const r = ok(await call('POST', '/reservations/opening', {
    guest: { full_name: 'Cutover, Guest', contact_no: '1' }, check_in: addDays(T, -1), check_out: addDays(T, 1), in_house: true, wincloud_ref: 'WC-77',
    opening_paid: 500000, opening_charges: 20000, lines: [{ room_id: await roomId('VR108'), adults: 2 }],
  }, 'fosup'));
  assert.equal(r.lines[0].line_status, 'Checked In');
  assert.equal(r.totals.total, 1200000 + 20000);
  assert.equal(r.totals.outstanding, 1220000 - 500000);
  assert.equal((await call('POST', '/reservations/opening', { guest: { full_name: 'x', contact_no: '1' } }, 'cashier')).status, 403);
});

test('day tour: advance deposit, cancel keeps history, find advance booking', async () => {
  const g = ok(await call('POST', '/daytour/groups', { booking_type: 'Advance', group_name: 'LGU Outing', contact_no: '1', arrival_date: addDays(T, 3), estimated_guests: 20, payment_terms: 'Pay on arrival' }));
  assert.equal(g.advance.allowed, false);
  assert.equal((await call('POST', `/daytour/groups/${g.group.id}/payments`, { tenders: [{ method: 'Cash', amount: 100000 }] })).status, 409);
  ok(await call('PUT', `/daytour/groups/${g.group.id}`, { payment_terms: 'Down payment' }));
  const d = ok(await call('GET', `/daytour/groups/${g.group.id}`));
  assert.equal(d.advance.estimate, 20 * 50000);
  assert.equal((await call('POST', `/daytour/groups/${g.group.id}/payments`, { tenders: [{ method: 'Cash', amount: 1000001 }] })).status, 400);
  const p = ok(await call('POST', `/daytour/groups/${g.group.id}/payments`, { tenders: [{ method: 'GCash', amount: 300000, reference: 'GC-9' }] }));
  assert.equal(p.payment.receipt.receipt_no.startsWith('OR-'), true);
  assert.equal(p.totals.groupPaid, 300000);
  const found = ok(await call('GET', '/daytour/groups?status=Advance%20Booking&q=LGU'));
  assert.equal(found.groups.length, 1);
});

test('day tour cutover: group on site with lockers and opening balances', async () => {
  const g = ok(await call('POST', '/daytour/opening', {
    on_site: true, group_name: 'Cutover Group', contact_no: '1', legacy_ref: 'OLD-55', counts: { ADULT: 4, CHILD: 1 }, opening_paid: 230000,
    lockers: [{ locker_id: 'RED-200', occupants: '1 Adult', opening_balance: 45000 }, { locker_id: 'BLUE-200', occupants: '1 Adult' }],
  }, 'fosup'));
  assert.equal(g.group.group_status, 'Arrived / Active');
  assert.equal(g.totals.entrance, 4 * 50000 + 30000);
  assert.equal(g.totals.groupAccountBalance, 0);
  assert.equal(g.totals.outstanding, 45000);
  assert.equal(g.accounts.length, 2);
  assert.equal((await call('POST', '/daytour/opening', { on_site: true, group_name: 'x', contact_no: '1', legacy_ref: 'r', counts: { ADULT: 1 }, lockers: [{ locker_id: 'RED-200', occupants: 'x' }] }, 'fosup')).status, 409);
  assert.equal((await call('POST', '/daytour/opening', { on_site: true, group_name: 'x', contact_no: '1', legacy_ref: 'r', counts: { ADULT: 1 } }, 'cashier')).status, 403);
});

test('discounts: Senior / PWD needs verified ID; receipt prints the SC/PWD block only then', async () => {
  const g = ok(await call('POST', '/daytour/groups', { booking_type: 'Walk-in', group_name: 'Seniors', contact_no: '1' }));
  ok(await call('POST', `/daytour/groups/${g.group.id}/counts`, { counts: { SENIOR: 2 } }));
  assert.equal((await call('POST', `/daytour/groups/${g.group.id}/discounts`, { category: 'Senior Citizen', amount: 10000, reason: 'OSCA 123', approval: { username: 'fosup', password: 'fosup123' } })).status, 400);
  const d = ok(await call('POST', `/daytour/groups/${g.group.id}/discounts`, { category: 'Senior Citizen', amount: 20000, reason: 'OSCA 123', id_verified: true, basis: '20% of 1 entrance', approval: { username: 'fosup', password: 'fosup123' } }));
  assert.equal(d.totals.groupAccountBalance, 80000);
  const p = ok(await call('POST', `/daytour/groups/${g.group.id}/payments`, { tenders: [{ method: 'Cash', amount: 80000 }] }));
  const rc = ok(await call('GET', `/payments/${p.payment.id}/receipt`));
  assert.equal(rc.scpwd.length, 1);
  assert.ok(rc.lines[0].sub.some((x) => x.amount === -20000));
});

test('daily reconciliation: system figures vs old system, variances must be explained', async () => {
  const r = ok(await call('GET', `/reports/reconciliation?date=${T}`, null, 'fosup'));
  const cash = r.lines.find((l) => l.key === 'fo:Cash');
  assert.ok(cash.system > 0);
  assert.equal((await call('POST', '/reports/reconciliation', { business_date: T, external: { 'fo:Cash': cash.system - 100 } }, 'fosup')).status, 400);
  ok(await call('POST', '/reports/reconciliation', { business_date: T, external: { 'fo:Cash': cash.system - 100 }, notes_by_line: { 'fo:Cash': 'Short 1.00, counted again' } }, 'fosup'));
  assert.equal(ok(await call('GET', `/reports/reconciliation?date=${T}`, null, 'fosup')).saved.length, 1);
});

test('down payment follow-up list and follow-up log', async () => {
  const r = ok(await call('POST', '/reservations', { guest: { full_name: 'Follow, Up', contact_no: '1' }, source: 'Website', check_in: addDays(T, 20), check_out: addDays(T, 21), lines: [{ room_id: await roomId('VR110'), adults: 2 }] }, 'marketing'));
  let list = ok(await call('GET', '/reservations?view=followup', null, 'marketing')).reservations;
  assert.ok(list.some((x) => x.id === r.reservation.id));
  ok(await call('POST', `/reservations/${r.reservation.id}/follow-up`, { note: 'Messaged on Facebook, will pay tomorrow' }, 'marketing'));
  list = ok(await call('GET', '/reservations?view=followup', null, 'marketing')).reservations;
  assert.equal(list.find((x) => x.id === r.reservation.id).last_follow_up.reason, 'Messaged on Facebook, will pay tomorrow');
  ok(await call('POST', `/reservations/${r.reservation.id}/payments`, { tenders: [{ method: 'GCash', amount: r.totals.downPaymentRequired }] }));
  list = ok(await call('GET', '/reservations?view=followup', null, 'marketing')).reservations;
  assert.ok(!list.some((x) => x.id === r.reservation.id), 'paid down payment leaves the list');
});

test('Check-in Pending, Part 1 payment labels, and Phase 3 housekeeping setting', async () => {
  const room = await roomId('VR109');
  const r = ok(await call('POST', '/reservations', { guest: { full_name: 'Pending, Guest', contact_no: '1' }, source: 'Walk-in', check_in: T, check_out: addDays(T, 1), lines: [{ room_id: room, adults: 2 }] }));
  const id = r.reservation.id; const line = r.lines[0].id;
  ok(await call('POST', `/rooms/${room}/hk-status`, { to: 'Dirty' }, 'hk'));
  let d = ok(await call('POST', `/reservations/${id}/lines/${line}/arrived`, { note: 'Waiting in restaurant' }));
  assert.equal(d.lines[0].stay_status, 'Check-in Pending');
  assert.equal(d.lines[0].occupancy_status, 'Not Arrived');
  ok(await call('POST', `/rooms/${room}/hk-status`, { to: 'Clean' }, 'hk'));
  ok(await call('POST', `/reservations/${id}/id-verify`, { id_type: 'Passport', verified: true }));
  ok(await call('POST', `/reservations/${id}/signed-form`, { line_ids: [line], paper_on_file: true }));
  ok(await call('POST', `/reservations/${id}/payments`, { tenders: [{ method: 'Cash', amount: r.totals.total }] }));
  // Phase 3: Housekeeping module live -> Front Office tick no longer required
  ok(await call('PUT', '/admin/settings', { settings: { fo_confirms_housekeeping: false } }, 'admin'));
  d = ok(await call('POST', `/reservations/${id}/checkin`, { line_ids: [line] }));
  ok(await call('PUT', '/admin/settings', { settings: { fo_confirms_housekeeping: true } }, 'admin'));
  assert.equal(d.reservation.payment_status, 'Settled', 'Part 1 s4.2 label while in-house');
  ok(await call('POST', '/department/transactions', { department: 'Mini Bar', method: 'charge', target: { type: 'room', room_no: 'VR109' }, items: [{ name: 'Soda', qty: 1, price: 6000 }] }, 'admin'));
  assert.equal(ok(await call('GET', `/reservations/${id}`)).reservation.payment_status, 'Balance Due');
});

test('day tour: cancelled advance booking deposit - refund or forfeit with approval', async () => {
  const mk = async (name) => {
    const g = ok(await call('POST', '/daytour/groups', { booking_type: 'Advance', group_name: name, contact_no: '1', arrival_date: addDays(T, 5), estimated_guests: 10, payment_terms: 'Down payment' }));
    ok(await call('POST', `/daytour/groups/${g.group.id}/payments`, { tenders: [{ method: 'Cash', amount: 200000 }] }));
    ok(await call('POST', `/daytour/groups/${g.group.id}/cancel`, { reason: 'Event moved' }));
    return g.group.id;
  };
  const a = await mk('Refund Group');
  assert.equal((await call('POST', `/daytour/groups/${a}/refund-decision`, { decision: 'No Refund', reason: 'x' })).status, 403);
  let d = ok(await call('POST', `/daytour/groups/${a}/refund-decision`, { decision: 'Refund Completed', amount: 200000, method: 'Cash', reason: 'Management approved', approval: { username: 'fosup', password: 'fosup123' } }));
  assert.equal(d.totals.outstanding, 0);
  assert.equal(d.group.refund_decision, 'Refund Completed');
  const b = await mk('Forfeit Group');
  d = ok(await call('POST', `/daytour/groups/${b}/refund-decision`, { decision: 'No Refund', reason: 'Late cancellation' }, 'fosup'));
  assert.equal(d.totals.outstanding, 0);
  assert.equal((await call('POST', `/daytour/groups/${b}/refund-decision`, { decision: 'No Refund', reason: 'again' }, 'fosup')).status, 409);
});

test('A4: Available after clearance can be issued to the next group', async () => {
  const g = ok(await call('POST', '/daytour/groups', { booking_type: 'Walk-in', group_name: 'Next Group', contact_no: '1' }));
  ok(await call('POST', `/daytour/groups/${g.group.id}/counts`, { counts: { ADULT: 1 } }));
  ok(await call('POST', `/daytour/groups/${g.group.id}/payments`, { tenders: [{ method: 'Cash', amount: 50000 }] }));
  const d = ok(await call('POST', `/daytour/groups/${g.group.id}/lockers`, { locker_id: 'RED-015', occupants: '1 Adult' }));
  assert.equal(d.accounts[0].locker_status, 'Assigned');
});

test('A5: Adjustment Pending for a credit or a pending approval; credit refund clears it', async () => {
  const room = await roomId('DX205');
  const r = ok(await call('POST', '/reservations', { guest: { full_name: 'Credit, Guest', contact_no: '1' }, source: 'Website', check_in: addDays(T, 30), check_out: addDays(T, 31), lines: [{ room_id: room, adults: 2 }] }));
  const id = r.reservation.id;
  const c = ok(await call('POST', `/reservations/${id}/charges`, { kind: 'extra', description: 'Airport pickup', amount: 100000, reason: 'Requested by guest' }));
  ok(await call('POST', `/reservations/${id}/payments`, { tenders: [{ method: 'Cash', amount: c.totals.total }] }));
  let d = ok(await call('POST', `/reservations/${id}/charges/${c.charges[0].id}/void`, { reason: 'Cancelled pickup' }, 'fosup'));
  assert.equal(d.totals.outstanding, -100000);
  assert.equal(d.reservation.payment_status, 'Adjustment Pending');
  assert.equal((await call('POST', `/reservations/${id}/credit-refund`, { amount: 100001, method: 'Cash', reason: 'x' }, 'fosup')).status, 400);
  d = ok(await call('POST', `/reservations/${id}/credit-refund`, { amount: 100000, method: 'Cash', reason: 'Pickup cancelled' }, 'fosup'));
  assert.equal(d.reservation.payment_status, 'Paid');
  const ap = ok(await call('POST', '/approvals', { type: 'transfer_waiver', entity: 'reservation', entity_id: id, payload: { line_id: d.lines[0].id, to_room_id: 1 }, summary: 's', reason: 'r' }));
  assert.equal(ok(await call('GET', `/reservations/${id}`)).reservation.payment_status, 'Adjustment Pending');
  ok(await call('POST', `/approvals/${ap.approval.id}/reject`, { note: 'No' }, 'fosup'));
  assert.equal(ok(await call('GET', `/reservations/${id}`)).reservation.payment_status, 'Paid');
});

test('A3: suggest other dates when a category is full', async () => {
  const fm = ok(await call('GET', '/rooms', null)).rooms.filter((x) => x.category === 'Family');
  const a = addDays(T, 40); const b = addDays(T, 41);
  ok(await call('POST', '/reservations', { guest: { full_name: 'Full, House', contact_no: '1' }, source: 'Website', check_in: a, check_out: b, lines: fm.map((x) => ({ room_id: x.id, adults: 2 })) }));
  const s = ok(await call('GET', `/rooms/availability/suggest?from=${a}&to=${b}&room_type_id=${fm[0].room_type_id}`)).suggestions;
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => x.from !== a && x.free > 0));
});

test('notifications: role-based alerts', async () => {
  const sup = ok(await call('GET', '/reports/alerts', null, 'fosup')).alerts;
  assert.ok(Array.isArray(sup));
  const hk = ok(await call('GET', '/reports/alerts', null, 'hk')).alerts;
  assert.ok(!hk.some((a) => a.key.startsWith('approvals:')), 'housekeeping does not see approval alerts');
  // A waiting guest whose room becomes ready shows up for Front Office
  const room = await roomId('DX206');
  const r = ok(await call('POST', '/reservations', { guest: { full_name: 'Waiting, Guest', contact_no: '1' }, source: 'Walk-in', check_in: T, check_out: addDays(T, 1), lines: [{ room_id: room, adults: 1 }] }));
  ok(await call('POST', `/rooms/${room}/hk-status`, { to: 'Dirty' }, 'hk'));
  ok(await call('POST', `/reservations/${r.reservation.id}/lines/${r.lines[0].id}/arrived`, {}));
  assert.ok(ok(await call('GET', '/reports/alerts', null, 'hk')).alerts.some((a) => a.key.startsWith('hkurgent:') && a.text.includes('DX206')));
  ok(await call('POST', `/rooms/${room}/hk-status`, { to: 'Clean' }, 'hk'));
  assert.ok(ok(await call('GET', '/reports/alerts')).alerts.some((a) => a.key === `ready:${r.lines[0].id}`));
});
