// Shared business rules used by several route modules.
import { db, scalar } from './db.js';
import { bad, conflict, getSetting, nextNo, now, today, nightsBetween, audit, money, str } from './lib.js';

const sum = (sql, ...p) => scalar(`SELECT COALESCE(SUM(amount),0) AS v FROM ${sql}`, ...p) || 0;

// =====================================================================
// Rooms
// =====================================================================
export function occupyingStay(roomId) {
  return db.prepare(`SELECT s.*, l.reservation_id FROM guest_stays s JOIN reservation_room_lines l ON l.id = s.line_id
                     WHERE s.room_id = ? AND s.occupancy_status = 'Checked In'`).get(roomId);
}

/** Lines that hold a room for any night in [from, to). */
export function roomBookings(roomId, from, to, excludeLineIds = []) {
  return db.prepare(`SELECT l.id, r.reference, r.check_in, r.check_out FROM reservation_room_lines l
                     JOIN reservations r ON r.id = l.reservation_id
                     WHERE l.room_id = ? AND l.line_status IN ('Active','Checked In') AND r.check_in < ? AND r.check_out > ?`)
    .all(roomId, to, from).filter((x) => !excludeLineIds.includes(x.id));
}

export function assertRoomFree(room, from, to, excludeLineIds = []) {
  if (!room || !room.active) throw bad('Room not found or inactive.');
  const clash = roomBookings(room.id, from, to, excludeLineIds);
  if (clash.length) throw conflict(`Room ${room.room_no} is already booked for these dates (${clash[0].reference}).`);
  const occ = occupyingStay(room.id);
  if (occ && from <= today() && !excludeLineIds.includes(occ.line_id))
    throw conflict(`Room ${room.room_no} is still occupied.`);
}

/** Ready = Clean, no block, not occupied by another stay. */
export function roomReady(room, forLineId = null) {
  if (room.hk_status !== 'Clean') return { ready: false, why: `Housekeeping status is ${room.hk_status}` };
  if (room.block_status !== 'None') return { ready: false, why: room.block_status };
  const occ = occupyingStay(room.id);
  if (occ && occ.line_id !== forLineId) return { ready: false, why: 'Occupied' };
  return { ready: true };
}

/** Availability field for today, derived (never merged with housekeeping status). */
export function roomAvailabilityToday(room) {
  if (room.block_status !== 'None') return 'Under Repair / Blocked';
  if (occupyingStay(room.id)) return 'Occupied';
  const t = today();
  if (roomBookings(room.id, t, addOne(t)).length) return 'Reserved / Blocked';
  return room.hk_status === 'Clean' ? 'Available' : 'Not Ready';
}
const addOne = (d) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

export function setHkStatus(user, roomId, to, note) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (room.hk_status === to) return;
  db.prepare('UPDATE rooms SET hk_status = ?, hk_updated_at = ?, hk_updated_by = ? WHERE id = ?').run(to, now(), user?.username, roomId);
  db.prepare('INSERT INTO housekeeping_log(room_id, field, from_status, to_status, by_user, at, note) VALUES(?,?,?,?,?,?,?)')
    .run(roomId, 'hk_status', room.hk_status, to, user?.username, now(), note ?? null);
  // A room that is no longer clean loses any Front Office readiness confirmation.
  if (to !== 'Clean') db.prepare('UPDATE reservation_room_lines SET hk_confirmed_at = NULL, hk_confirmed_by = NULL WHERE room_id = ? AND line_status = \'Active\'').run(roomId);
  audit(user, 'room.hk_status', 'room', room.room_no, { from: room.hk_status, to, reason: note });
}

export function setBlock(user, roomId, to, reason) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  db.prepare('UPDATE rooms SET block_status = ?, block_reason = ?, needs_inspection = CASE WHEN ? = \'None\' THEN needs_inspection ELSE 1 END WHERE id = ?')
    .run(to, to === 'None' ? null : reason, to, roomId);
  db.prepare('INSERT INTO housekeeping_log(room_id, field, from_status, to_status, by_user, at, note) VALUES(?,?,?,?,?,?,?)')
    .run(roomId, 'block_status', room.block_status, to, user?.username, now(), reason ?? null);
  if (to !== 'None') db.prepare('UPDATE reservation_room_lines SET hk_confirmed_at = NULL, hk_confirmed_by = NULL WHERE room_id = ? AND line_status = \'Active\'').run(roomId);
  audit(user, 'room.block', 'room', room.room_no, { from: room.block_status, to, reason });
}

// =====================================================================
// Reservations
// =====================================================================
export function reservationTotals(resId) {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(resId);
  const nights = nightsBetween(r.check_in, r.check_out);
  const lines = db.prepare('SELECT * FROM reservation_room_lines WHERE reservation_id = ?').all(resId);
  const room = lines.filter((l) => l.line_status !== 'Cancelled').reduce((s, l) => s + l.rate_per_night * nights, 0);
  const charges = sum('folio_charges WHERE reservation_id = ?', resId);
  const dept = sum("department_transactions WHERE method = 'charge' AND target_type = 'reservation' AND target_id = ?", resId);
  const discounts = sum("discount_lines WHERE target_type = 'reservation' AND target_id = ?", resId);
  const paid = sum("payment_allocations WHERE target_type = 'reservation' AND target_id = ?", resId);
  const total = room + charges + dept - discounts;
  const downPaymentRequired = Math.round((room * r.down_payment_pct) / 100);
  return {
    nights, room, charges, dept, discounts, total, paid,
    outstanding: total - paid,
    downPaymentRequired,
    downPaymentOutstanding: Math.max(0, downPaymentRequired - paid),
  };
}

export function refreshReservationStatus(resId) {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(resId);
  const lines = db.prepare("SELECT line_status FROM reservation_room_lines WHERE reservation_id = ? AND line_status != 'Cancelled'").all(resId);
  let status = r.reservation_status;
  if (status !== 'Cancelled' && lines.length) {
    const allIn = lines.every((l) => l.line_status === 'Checked In' || l.line_status === 'Checked Out');
    const anyIn = lines.some((l) => l.line_status === 'Checked In');
    const allOut = lines.every((l) => l.line_status === 'Checked Out');
    const partialRule = getSetting('rm01_partial_checkin_status', 'active_until_last');
    if (allOut) status = 'Checked Out';
    else if (allIn || (anyIn && partialRule === 'checked_in_on_first')) status = 'Checked In';
    else status = 'Active / Booked';
  }
  const t = reservationTotals(resId);
  const part1 = getSetting('payment_status_labels', 'part1') !== 'part3';
  const inHouse = lines.some((l) => l.line_status === 'Checked In');
  let pay;
  if (status === 'Cancelled') {
    pay = r.refund_decision || (t.paid > 0 ? 'Refund Pending' : 'No Refund');
    if (!part1 && pay === 'Refund Completed') pay = 'Refunded';
  } else if (t.outstanding < 0 || db.prepare("SELECT 1 FROM approval_requests WHERE entity = 'reservation' AND entity_id = ? AND status = 'Pending'").get(resId)) {
    // Part 3 s2.2: a credit owed to the guest, or a price adjustment waiting for approval.
    pay = 'Adjustment Pending';
  } else if (status === 'Checked Out') pay = t.outstanding <= 0 ? 'Closed' : 'Balance Due';
  else if (inHouse && part1) pay = t.outstanding <= 0 ? 'Settled' : 'Balance Due'; // Part 1 s4.2: guest in-house
  else if (t.paid <= 0 && t.total > 0) pay = 'Unpaid';
  else if (t.outstanding <= 0) pay = 'Paid';
  else pay = 'Partially Paid';
  db.prepare('UPDATE reservations SET reservation_status = ?, payment_status = ?, updated_at = ? WHERE id = ?').run(status, pay, now(), resId);
  return { status, pay };
}

// =====================================================================
// Day Tour groups & lockers
// =====================================================================
export function lockerAccountBalance(accountId) {
  const charges = sum('group_charges WHERE locker_account_id = ?', accountId);
  const dept = sum("department_transactions WHERE method = 'charge' AND target_type = 'locker_account' AND target_id = ?", accountId);
  const disc = sum("discount_lines WHERE target_type = 'locker_account' AND target_id = ?", accountId);
  const paid = sum("payment_allocations WHERE target_type = 'locker_account' AND target_id = ?", accountId);
  return { charges: charges + dept, discounts: disc, paid, balance: charges + dept - disc - paid };
}

export function groupTotals(groupId) {
  const entrance = scalar('SELECT COALESCE(SUM(count * rate),0) AS v FROM group_guest_counts WHERE group_id = ?', groupId) || 0;
  const facility = sum("group_charges WHERE group_id = ? AND locker_account_id IS NULL AND kind IN ('facility')", groupId);
  const otherGroup = sum("group_charges WHERE group_id = ? AND locker_account_id IS NULL AND kind NOT IN ('facility')", groupId);
  const groupDept = sum("department_transactions WHERE method = 'charge' AND target_type = 'group' AND target_id = ?", groupId);
  const groupDisc = sum("discount_lines WHERE target_type = 'group' AND target_id = ?", groupId);
  const groupPaid = sum("payment_allocations WHERE target_type = 'group' AND target_id = ?", groupId);
  const groupAccount = entrance + facility + otherGroup + groupDept - groupDisc - groupPaid;
  const accounts = db.prepare('SELECT id FROM locker_accounts WHERE group_id = ?').all(groupId);
  const lockers = accounts.reduce((s, a) => s + lockerAccountBalance(a.id).balance, 0);
  const entryCharges = entrance + facility;
  return {
    entrance, facility, otherGroup, groupDept, groupDiscounts: groupDisc, groupPaid,
    groupAccountBalance: groupAccount,
    lockerBalances: lockers,
    // Group outstanding is a rollup: group account + each locker account, never counted twice.
    outstanding: groupAccount + lockers,
    entryCharges,
    entryPaid: entryCharges > 0 ? groupPaid >= entryCharges - groupDisc : true,
  };
}

export function openAssignment(accountId) {
  return db.prepare('SELECT * FROM locker_assignments WHERE account_id = ? AND ended_at IS NULL').get(accountId);
}

/** After a payment or key return: a locker becomes Available only when its key is back AND its account is settled. */
export function clearLockerIfDone(user, accountId) {
  const a = openAssignment(accountId);
  if (!a || !a.key_returned_at) return false;
  if (lockerAccountBalance(accountId).balance > 0) {
    db.prepare("UPDATE lockers SET locker_status = 'Key Returned - Unsettled' WHERE id = ?").run(a.locker_id);
    return false;
  }
  db.prepare("UPDATE locker_assignments SET ended_at = ?, ended_by = ?, end_reason = 'returned' WHERE id = ?").run(now(), user?.username, a.id);
  // Part 3 Fig. 2: key back + all paid -> "Available after clearance"; it can be issued to the next group.
  db.prepare("UPDATE lockers SET locker_status = 'Available after clearance', status_note = NULL WHERE id = ?").run(a.locker_id);
  audit(user, 'locker.cleared', 'locker', a.locker_id, { from: 'Key Returned - Unsettled', to: 'Available after clearance', reason: 'Key returned and all linked charges settled' });
  return true;
}

// =====================================================================
// Payments, tenders, allocations, receipts
// =====================================================================
export function validateTenders(tenders) {
  const methods = getSetting('payment_methods', []);
  if (!Array.isArray(tenders) || tenders.length === 0) throw bad('Add at least one tender line.');
  return tenders.map((t, i) => {
    const method = str(t.method, `Tender ${i + 1} method`);
    if (!methods.includes(method)) throw bad(`Payment method "${method}" is not enabled.`);
    return { method, amount: money(t.amount, `Tender ${i + 1} amount`, { allowZero: false }), reference: t.reference ? String(t.reference).trim().slice(0, 100) : null };
  });
}

/**
 * Records one payment with one or more tender lines, allocated exactly once across accounts,
 * and issues one receipt for the settlement.
 */
export function recordPayment(user, { accountType, accountId, purpose, tenders, allocations, note, kind = 'payment', issueReceipt = true }) {
  const t = kind === 'payment' ? validateTenders(tenders) : tenders;
  const total = t.reduce((s, x) => s + x.amount, 0);
  const allocTotal = allocations.reduce((s, a) => s + a.amount, 0);
  if (total !== allocTotal) throw bad('Tender total must equal the amount allocated.');
  if (allocations.some((a) => !Number.isInteger(a.amount) || a.amount === 0)) throw bad('Invalid allocation amount.');
  const payment_no = nextNo('payment', 'PAY-', 6);
  const pid = Number(db.prepare(`INSERT INTO payments(payment_no, kind, account_type, account_id, purpose, total, cashier, note, paid_at)
                                 VALUES(?,?,?,?,?,?,?,?,?)`).run(payment_no, kind, accountType, accountId, purpose ?? null, total, user.username, note ?? null, now()).lastInsertRowid);
  const insT = db.prepare('INSERT INTO payment_tenders(payment_id, method, amount, reference) VALUES(?,?,?,?)');
  for (const x of t) insT.run(pid, x.method, x.amount, x.reference);
  const insA = db.prepare('INSERT INTO payment_allocations(payment_id, target_type, target_id, amount) VALUES(?,?,?,?)');
  for (const a of allocations) insA.run(pid, a.target_type, a.target_id, a.amount);
  let receipt = null;
  if (issueReceipt) {
    const docTypes = getSetting('receipt_doc_types', {});
    const doc_type = docTypes[purpose] || docTypes.default || 'Official Receipt';
    const receipt_no = nextNo('receipt', getSetting('receipt_prefix', 'OR-'), 6);
    db.prepare('INSERT INTO receipts(receipt_no, doc_type, payment_id, issued_by, issued_at) VALUES(?,?,?,?,?)').run(receipt_no, doc_type, pid, user.username, now());
    receipt = { receipt_no, doc_type };
  }
  audit(user, `payment.${kind}`, accountType, accountId, { to: { payment_no, total, tenders: t, allocations, purpose }, reason: note });
  return { id: pid, payment_no, total, receipt };
}

export function paymentsFor(targetType, targetIds) {
  if (!targetIds.length) return [];
  const ph = targetIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT DISTINCT p.*, r.receipt_no, r.doc_type, r.reprint_count FROM payments p
                           JOIN payment_allocations a ON a.payment_id = p.id
                           LEFT JOIN receipts r ON r.payment_id = p.id
                           WHERE a.target_type = ? AND a.target_id IN (${ph}) ORDER BY p.id`).all(targetType, ...targetIds);
  return rows.map((p) => ({
    ...p,
    tenders: db.prepare('SELECT method, amount, reference FROM payment_tenders WHERE payment_id = ?').all(p.id),
    allocations: db.prepare('SELECT target_type, target_id, amount FROM payment_allocations WHERE payment_id = ?').all(p.id),
  }));
}

export { today };
