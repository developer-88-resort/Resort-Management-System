// Day Tour Management (Part 2 Figs. 4-5, Part 3 Figs. 1-3).
// One parent Group Account; locker accounts are linked children. Group outstanding is a rollup, never double-counted.
import express from 'express';
import { db } from '../db.js';
import {
  authenticate, requirePerm, bad, notFound, conflict, HttpError, str, int, money, isDate, today, now, audit, tx, nextNo,
  getSetting, verifyApproval, oneOf,
} from '../lib.js';
import { groupTotals, lockerAccountBalance, openAssignment, clearLockerIfDone, recordPayment, validateTenders } from '../domain.js';
import { currentRates } from './admin.js';

export const dayTourRouter = express.Router();
dayTourRouter.use(authenticate);

const ON_SITE = ['Arrived / Active', 'Settling'];
const PAYERS = ['Representative', 'Self', 'Organizer'];

function loadGroup(id) {
  const g = db.prepare('SELECT * FROM day_tour_groups WHERE id = ? OR reference = ?').get(id, String(id).toUpperCase());
  if (!g) throw notFound('Day Tour group');
  return g;
}

function accountView(a) {
  const asg = db.prepare('SELECT * FROM locker_assignments WHERE account_id = ? ORDER BY id').all(a.id);
  const open = asg.find((x) => !x.ended_at) || null;
  const current = open || asg[asg.length - 1] || null;
  const bal = lockerAccountBalance(a.id);
  const dept = db.prepare("SELECT * FROM department_transactions WHERE method = 'charge' AND target_type = 'locker_account' AND target_id = ? ORDER BY id").all(a.id)
    .map((d) => ({ ...d, items: JSON.parse(d.items) }));
  const charges = db.prepare('SELECT * FROM group_charges WHERE locker_account_id = ? ORDER BY id').all(a.id);
  let key;
  if (open && open.key_returned_at) key = 'Returned';
  else if (open) key = 'Not returned';
  else if (current?.end_reason === 'lost') key = 'Lost';
  else key = 'Returned';
  const locker = current ? db.prepare('SELECT * FROM lockers WHERE id = ?').get(current.locker_id) : null;
  const cleared = bal.balance <= 0 && (!open || !!open.key_returned_at);
  return { ...a, locker_id: current?.locker_id, locker_status: locker?.locker_status, color: locker?.color, open_assignment: open, history: asg, key,
    ...bal, dept, charges, clearance: cleared ? 'Cleared' : key === 'Not returned' ? 'Key out' : bal.balance > 0 ? 'Unsettled' : 'Cleared' };
}

export function groupDetail(id) {
  const g = loadGroup(id);
  const counts = db.prepare('SELECT * FROM group_guest_counts WHERE group_id = ? ORDER BY id').all(g.id);
  const charges = db.prepare('SELECT * FROM group_charges WHERE group_id = ? AND locker_account_id IS NULL ORDER BY id').all(g.id);
  const accounts = db.prepare('SELECT * FROM locker_accounts WHERE group_id = ? ORDER BY id').all(g.id).map(accountView);
  const groupDept = db.prepare("SELECT * FROM department_transactions WHERE method = 'charge' AND target_type = 'group' AND target_id = ? ORDER BY id").all(g.id)
    .map((d) => ({ ...d, items: JSON.parse(d.items) }));
  const payments = db.prepare(`SELECT p.*, r.receipt_no, r.doc_type FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
                               WHERE p.account_type = 'group' AND p.account_id = ? ORDER BY p.id`).all(g.id)
    .map((p) => ({ ...p, tenders: db.prepare('SELECT method, amount, reference FROM payment_tenders WHERE payment_id = ?').all(p.id),
      allocations: db.prepare('SELECT target_type, target_id, amount FROM payment_allocations WHERE payment_id = ?').all(p.id) }));
  const incidents = db.prepare('SELECT * FROM locker_incidents WHERE group_id = ? ORDER BY id').all(g.id);
  const totals = groupTotals(g.id);
  const discounts = db.prepare(`SELECT * FROM discount_lines WHERE (target_type = 'group' AND target_id = ?)
      OR (target_type = 'locker_account' AND target_id IN (SELECT id FROM locker_accounts WHERE group_id = ?)) ORDER BY id`).all(g.id, g.id);
  const history = db.prepare("SELECT * FROM audit_events WHERE entity = 'day_tour_group' AND entity_id = ? ORDER BY id DESC").all(String(g.id));
  const canIssueKeys = totals.entryPaid || !!g.entry_exception_by;
  const keysOut = accounts.filter((a) => a.key === 'Not returned').length;
  return {
    group: g, counts, charges, accounts, groupDept, payments, incidents, totals, discounts, history,
    advance: g.group_status === 'Advance Booking' ? advanceInfo(g) : null,
    gates: {
      canIssueKeys,
      allSettled: totals.outstanding <= 0,
      allKeysBack: keysOut === 0,
      keysReturned: accounts.filter((a) => a.key !== 'Not returned').length,
      lockersIssued: accounts.length,
    },
  };
}

/** Estimate for an advance booking: estimated guests x the configured Regular Adult rate on the arrival date (OD-06). */
export function advanceInfo(g) {
  const adult = currentRates(g.arrival_date).find((r) => r.code === 'ADULT');
  const estimate = (g.estimated_guests || 0) * (adult?.amount || 0);
  const paid = groupTotals(g.id).groupPaid;
  return { allowed: ['Down payment', 'Full advance'].includes(g.payment_terms), estimate, paid, remaining: Math.max(0, estimate - paid), rate: adult?.amount || 0 };
}

// ---------------------------------------------------------------------
dayTourRouter.get('/groups', requirePerm('daytour.view'), (req, res) => {
  const where = [];
  const p = [];
  if (isDate(req.query.date)) { where.push('arrival_date = ?'); p.push(req.query.date); }
  if (req.query.status === 'onsite') where.push(`group_status IN ('Arrived / Active','Settling')`);
  else if (req.query.status) { where.push('group_status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(reference LIKE ? OR group_name LIKE ? OR contact_no LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = db.prepare(`SELECT * FROM day_tour_groups ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY arrival_date DESC, id DESC LIMIT 300`).all(...p);
  res.json({ groups: rows.map((g) => ({ ...g, totals: groupTotals(g.id), lockers: db.prepare("SELECT COUNT(*) AS c FROM locker_accounts WHERE group_id = ?").get(g.id).c })) });
});

dayTourRouter.get('/groups/:id', requirePerm('daytour.view'), (req, res) => res.json(groupDetail(req.params.id)));

dayTourRouter.get('/rates', requirePerm('daytour.view'), (req, res) => {
  res.json({ rates: currentRates(isDate(req.query.date) ? req.query.date : today()) });
});

/** Create a walk-in (same day) or advance booking (organizer, contact, date, estimate only). */
dayTourRouter.post('/groups', requirePerm('daytour'), (req, res) => {
  const b = req.body;
  const booking_type = oneOf(b.booking_type, ['Walk-in', 'Advance'], 'Booking type');
  const group_name = str(b.group_name, 'Group / organizer name');
  const contact_no = str(b.contact_no, 'Contact number', { max: 40 });
  const arrival_date = booking_type === 'Walk-in' ? today() : b.arrival_date;
  if (!isDate(arrival_date) || arrival_date < today()) throw bad('Arrival date must be today or later.');
  const estimated_guests = int(b.estimated_guests ?? 0, 'Estimated guests');
  const rate_basis = oneOf(b.rate_basis || 'Standard walk-in rates', getSetting('daytour_rate_bases', []), 'Rate basis');
  const agreement_ref = b.agreement_ref ? String(b.agreement_ref).trim() : null;
  if (rate_basis !== 'Standard walk-in rates' && !agreement_ref) throw bad('A special rate needs the agreement / approval reference (OD-07, OD-08).');
  const payment_terms = oneOf(b.payment_terms || 'Pay on arrival', getSetting('daytour_payment_terms', []), 'Payment terms');
  const id = tx(() => {
    const gid = Number(db.prepare('INSERT INTO guests(full_name, contact_no, created_at) VALUES(?,?,?)').run(b.organizer_name || group_name, contact_no, now()).lastInsertRowid);
    const reference = nextNo('daytour', 'DT-', 4);
    const id = Number(db.prepare(`INSERT INTO day_tour_groups(reference, organizer_guest_id, group_name, contact_no, booking_type, arrival_date, estimated_guests,
        rate_basis, agreement_ref, payment_terms, group_status, remarks, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(reference, gid, group_name, contact_no, booking_type, arrival_date, estimated_guests, rate_basis, agreement_ref, payment_terms, 'Advance Booking', b.remarks || null, req.user.username, now()).lastInsertRowid);
    audit(req.user, 'daytour.create', 'day_tour_group', id, { to: { reference, booking_type, arrival_date, estimated_guests, rate_basis, payment_terms } });
    return id;
  });
  res.json(groupDetail(id));
});

dayTourRouter.put('/groups/:id', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (['Checked Out', 'Cancelled'].includes(g.group_status)) throw conflict('Group is closed.');
  const b = req.body;
  const next = {
    group_name: str(b.group_name ?? g.group_name, 'Group / organizer name'),
    contact_no: str(b.contact_no ?? g.contact_no, 'Contact number', { max: 40 }),
    arrival_date: g.group_status === 'Advance Booking' ? (b.arrival_date ?? g.arrival_date) : g.arrival_date,
    estimated_guests: int(b.estimated_guests ?? g.estimated_guests, 'Estimated guests'),
    rate_basis: g.group_status === 'Advance Booking' ? oneOf(b.rate_basis ?? g.rate_basis, getSetting('daytour_rate_bases', []), 'Rate basis') : g.rate_basis,
    agreement_ref: b.agreement_ref ?? g.agreement_ref,
    payment_terms: oneOf(b.payment_terms ?? g.payment_terms, getSetting('daytour_payment_terms', []), 'Payment terms'),
    remarks: b.remarks ?? g.remarks,
  };
  if (!isDate(next.arrival_date) || (next.arrival_date !== g.arrival_date && next.arrival_date < today())) throw bad('Invalid arrival date.');
  if (next.rate_basis !== 'Standard walk-in rates' && !next.agreement_ref) throw bad('A special rate needs the agreement / approval reference.');
  db.prepare(`UPDATE day_tour_groups SET group_name=?, contact_no=?, arrival_date=?, estimated_guests=?, rate_basis=?, agreement_ref=?, payment_terms=?, remarks=? WHERE id=?`)
    .run(next.group_name, next.contact_no, next.arrival_date, next.estimated_guests, next.rate_basis, next.agreement_ref, next.payment_terms, next.remarks, g.id);
  audit(req.user, 'daytour.update', 'day_tour_group', g.id, { from: g, to: next, reason: b.reason });
  res.json(groupDetail(g.id));
});

/**
 * Activate Group (arrival) / update actual counts. Estimate is kept; actual counts drive charges.
 * Rates come from the configured table. Special rates need approval. Pets are not counted as guests.
 */
dayTourRouter.post('/groups/:id/counts', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (!['Advance Booking', 'Arrived / Active'].includes(g.group_status)) throw conflict(`Counts cannot change while the group is ${g.group_status}.`);
  if (g.group_status === 'Advance Booking' && g.arrival_date !== today()) throw conflict(`This group arrives on ${g.arrival_date}. Change the arrival date first.`);
  const rates = currentRates(g.arrival_date).filter((r) => r.kind === 'guest');
  const counts = req.body.counts || {};
  const overrides = req.body.rate_overrides || {};
  let approver = null;
  if (Object.keys(overrides).length) {
    if (g.rate_basis === 'Standard walk-in rates') throw bad('Rate overrides are only allowed for a special / agreement rate basis.');
    approver = verifyApproval(req, req.body.approval, 'A special rate');
  }
  const before = db.prepare('SELECT category_code, count, rate FROM group_guest_counts WHERE group_id = ?').all(g.id);
  tx(() => {
    let persons = 0;
    for (const r of rates) {
      const n = int(counts[r.code] ?? 0, `${r.name} count`);
      const rate = overrides[r.code] !== undefined && overrides[r.code] !== '' ? money(overrides[r.code], `${r.name} special rate`) : r.amount;
      db.prepare(`INSERT INTO group_guest_counts(group_id, category_code, category_name, counts_as_person, count, rate, rate_id, rate_override_by) VALUES(?,?,?,?,?,?,?,?)
                  ON CONFLICT(group_id, category_code) DO UPDATE SET count = excluded.count, rate = excluded.rate, rate_id = excluded.rate_id, rate_override_by = excluded.rate_override_by,
                  category_name = excluded.category_name, counts_as_person = excluded.counts_as_person`)
        .run(g.id, r.code, r.name, r.counts_as_person, n, rate, r.id, rate !== r.amount ? approver : null);
      if (r.counts_as_person) persons += n;
    }
    if (persons < 1) throw bad('Enter at least one guest.');
    const activating = g.group_status === 'Advance Booking';
    db.prepare(`UPDATE day_tour_groups SET actual_guests = ?, group_status = 'Arrived / Active', arrived_at = COALESCE(arrived_at, ?) WHERE id = ?`).run(persons, now(), g.id);
    audit(req.user, activating ? 'daytour.activate' : 'daytour.counts', 'day_tour_group', g.id,
      { from: activating ? 'Advance Booking' : before, to: { status: 'Arrived / Active', actual_guests: persons, counts }, approver });
  });
  res.json(groupDetail(g.id));
});

/** Kubo / Cottage are charge items, not guest categories. */
dayTourRouter.post('/groups/:id/facilities', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (!ON_SITE.includes(g.group_status)) throw conflict('Activate the group first.');
  const rate = currentRates(g.arrival_date).find((r) => r.code === req.body.code && r.kind === 'facility');
  if (!rate) throw bad('Choose a facility item.');
  const qty = int(req.body.qty, 'Quantity', { min: 1 });
  db.prepare(`INSERT INTO group_charges(group_id, kind, description, qty, rate, amount, rate_id, created_by, created_at) VALUES(?, 'facility', ?, ?, ?, ?, ?, ?, ?)`)
    .run(g.id, rate.name, qty, rate.amount, qty * rate.amount, rate.id, req.user.username, now());
  audit(req.user, 'daytour.facility', 'day_tour_group', g.id, { to: { item: rate.name, qty, amount: qty * rate.amount } });
  res.json(groupDetail(g.id));
});

dayTourRouter.post('/groups/:id/charges/:chargeId/void', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  const c = db.prepare('SELECT * FROM group_charges WHERE id = ? AND group_id = ?').get(req.params.chargeId, g.id);
  if (!c) throw notFound('Charge');
  if (c.reverses_id || c.amount < 0) throw conflict('A reversal cannot be voided.');
  if (db.prepare('SELECT 1 FROM group_charges WHERE reverses_id = ?').get(c.id)) throw conflict('Already voided.');
  const reason = str(req.body.reason, 'Reason');
  const approver = verifyApproval(req, req.body.approval, 'Voiding a charge');
  db.prepare(`INSERT INTO group_charges(group_id, locker_account_id, kind, description, qty, rate, amount, reason, reverses_id, approver, created_by, created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(g.id, c.locker_account_id, c.kind, `VOID: ${c.description}`, c.qty, c.rate, -c.amount, reason, c.id, approver, req.user.username, now());
  audit(req.user, 'daytour.void_charge', 'day_tour_group', g.id, { from: c, to: 'reversed', reason, approver });
  res.json(groupDetail(g.id));
});

/** Approved advance-group terms let keys be issued before entry charges are paid. */
dayTourRouter.post('/groups/:id/entry-exception', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  const reason = str(req.body.reason, 'Reason / agreement');
  const approver = verifyApproval(req, req.body.approval, 'Entry before payment');
  db.prepare('UPDATE day_tour_groups SET entry_exception_by = ?, entry_exception_reason = ? WHERE id = ?').run(approver, reason, g.id);
  audit(req.user, 'daytour.entry_exception', 'day_tour_group', g.id, { to: 'Entry allowed before payment', reason, approver });
  res.json(groupDetail(g.id));
});

dayTourRouter.post('/groups/:id/cancel', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (g.group_status !== 'Advance Booking') throw conflict('Only advance bookings that have not arrived can be cancelled.');
  const reason = str(req.body.reason, 'Cancellation reason');
  db.prepare("UPDATE day_tour_groups SET group_status = 'Cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ?").run(reason, req.user.username, now(), g.id);
  audit(req.user, 'daytour.cancel', 'day_tour_group', g.id, { from: 'Advance Booking', to: 'Cancelled', reason });
  res.json(groupDetail(g.id));
});

/**
 * Group payment. Allocations say which account receives how much (group account and/or lockers);
 * each payment is allocated exactly once and can't exceed the account balance.
 */
dayTourRouter.post('/groups/:id/payments', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (['Cancelled', 'Checked Out'].includes(g.group_status)) throw conflict(`Group is ${g.group_status}.`);
  const tenders = validateTenders(req.body.tenders);
  const total = tenders.reduce((s, t) => s + t.amount, 0);
  const t = groupTotals(g.id);
  // Advance booking with Down payment / Full advance terms (Part 2 Fig. 4 panel 4): the deposit is held on the
  // group account and is used against entrance charges once actual counts are recorded on arrival.
  if (g.group_status === 'Advance Booking') {
    const adv = advanceInfo(g);
    if (!adv.allowed) throw conflict(`Payment terms are "${g.payment_terms}". An advance payment is taken only under Down payment or Full advance terms.`);
    if (total > adv.remaining) throw bad(`Over-collection blocked. The estimate is ${(adv.estimate / 100).toFixed(2)} and ${(adv.paid / 100).toFixed(2)} is already received.`);
    const p = tx(() => recordPayment(req.user, { accountType: 'group', accountId: g.id, purpose: 'Advance deposit', tenders, allocations: [{ target_type: 'group', target_id: g.id, amount: total }], note: req.body.note }));
    return res.json({ ...groupDetail(g.id), payment: p });
  }
  let allocations = req.body.allocations;
  if (!Array.isArray(allocations) || !allocations.length) {
    if (total > t.groupAccountBalance) throw bad('Amount is more than the group account balance. Select lockers to pay for.');
    allocations = [{ target_type: 'group', target_id: g.id, amount: total }];
  }
  allocations = allocations.map((a) => {
    const amount = money(a.amount, 'Allocation', { allowZero: false });
    if (a.target_type === 'group') {
      if (Number(a.target_id) !== g.id) throw bad('Allocation to another group.');
      if (amount > t.groupAccountBalance) throw bad('Over-collection blocked on the group account.');
      return { target_type: 'group', target_id: g.id, amount };
    }
    if (a.target_type === 'locker_account') {
      const acc = db.prepare('SELECT * FROM locker_accounts WHERE id = ? AND group_id = ?').get(a.target_id, g.id);
      if (!acc) throw bad('Locker account is not part of this group.');
      if (amount > lockerAccountBalance(acc.id).balance) throw bad('Over-collection blocked on a locker account.');
      return { target_type: 'locker_account', target_id: acc.id, amount };
    }
    throw bad('Invalid allocation target.');
  });
  const out = tx(() => {
    const p = recordPayment(req.user, { accountType: 'group', accountId: g.id, purpose: req.body.purpose || (g.group_status === 'Settling' ? 'Group settlement' : 'Entry charges'), tenders, allocations, note: req.body.note });
    for (const a of allocations) if (a.target_type === 'locker_account') clearLockerIfDone(req.user, a.target_id);
    return p;
  });
  res.json({ ...groupDetail(g.id), payment: out });
});

dayTourRouter.post('/groups/:id/start-settlement', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (g.group_status !== 'Arrived / Active') throw conflict('Group is not active.');
  db.prepare("UPDATE day_tour_groups SET group_status = 'Settling' WHERE id = ?").run(g.id);
  audit(req.user, 'daytour.settling', 'day_tour_group', g.id, { from: g.group_status, to: 'Settling' });
  res.json(groupDetail(g.id));
});

/** Checked Out only when ALL required charges are settled AND every key is returned or cleared. */
dayTourRouter.post('/groups/:id/checkout', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (!ON_SITE.includes(g.group_status)) throw conflict(`Group is ${g.group_status}.`);
  const d = groupDetail(g.id);
  const failures = [];
  if (d.totals.outstanding > 0) failures.push(`Group outstanding ${(d.totals.outstanding / 100).toFixed(2)} is not settled.`);
  for (const a of d.accounts) if (a.key === 'Not returned') failures.push(`Locker ${a.locker_id}: key not returned.`);
  if (failures.length) throw new HttpError(422, 'The group cannot be checked out yet.', { failures });
  tx(() => {
    for (const a of d.accounts) {
      clearLockerIfDone(req.user, a.id);
      db.prepare("UPDATE locker_accounts SET status = 'Closed', closed_at = ? WHERE id = ?").run(now(), a.id);
    }
    db.prepare("UPDATE day_tour_groups SET group_status = 'Checked Out', checked_out_at = ? WHERE id = ?").run(now(), g.id);
    audit(req.user, 'daytour.checkout', 'day_tour_group', g.id, { from: g.group_status, to: 'Checked Out' });
  });
  res.json(groupDetail(g.id));
});

// ---------------------------------------------------------------------
// Lockers (RED-001..400 female, BLUE-001..400 male)
// ---------------------------------------------------------------------
function lockerInfo(id) {
  const l = db.prepare('SELECT * FROM lockers WHERE id = ?').get(id);
  if (!l) return null;
  const a = db.prepare(`SELECT a.*, g.reference, g.group_name FROM locker_assignments a JOIN day_tour_groups g ON g.id = a.group_id
                        WHERE a.locker_id = ? AND a.ended_at IS NULL`).get(id);
  return { ...l, assignment: a || null, balance: a ? lockerAccountBalance(a.account_id).balance : 0 };
}

dayTourRouter.get('/lockers', requirePerm('daytour.view'), (req, res) => {
  const rows = db.prepare(`SELECT l.*, a.account_id, g.reference FROM lockers l
      LEFT JOIN locker_assignments a ON a.locker_id = l.id AND a.ended_at IS NULL LEFT JOIN day_tour_groups g ON g.id = a.group_id
      WHERE (? IS NULL OR l.color = ?) ORDER BY l.color DESC, l.number`).all(req.query.color || null, req.query.color || null);
  const summary = {};
  for (const r of rows) summary[r.locker_status] = (summary[r.locker_status] || 0) + 1;
  res.json({ lockers: rows, summary });
});

dayTourRouter.get('/lockers/search', requirePerm('daytour.view'), (req, res) => {
  const color = oneOf(req.query.color, ['Red', 'Blue'], 'Key colour');
  const n = int(req.query.number, 'Locker number', { min: 1, max: getSetting('locker_count_per_color', 400) });
  const id = `${color === 'Red' ? 'RED' : 'BLUE'}-${String(n).padStart(3, '0')}`;
  res.json({ locker: lockerInfo(id) });
});

dayTourRouter.post('/groups/:id/lockers', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (g.group_status !== 'Arrived / Active') throw conflict('Lockers can only be issued to an active group.');
  const t = groupTotals(g.id);
  if (!t.entryPaid && !g.entry_exception_by) throw conflict('Key issue is locked until required entry charges are paid, or approved advance-group terms apply.');
  const lockerId = str(req.body.locker_id, 'Locker').toUpperCase();
  const type = oneOf(req.body.assignment_type || 'Individual', ['Individual', 'Shared'], 'Assignment type');
  const occupants = str(req.body.occupants, 'Linked occupants / category counts');
  const payer = oneOf(req.body.payer || 'Representative', PAYERS, 'Payer');
  const out = tx(() => {
    const l = lockerInfo(lockerId);
    if (!l) throw bad(`Locker ${lockerId} does not exist.`);
    if (l.locker_status !== 'Available' || l.assignment) throw conflict(`Cannot assign ${lockerId}: locker is ${l.assignment ? `already in use by ${l.assignment.reference}` : l.locker_status}.`);
    const acc = Number(db.prepare('INSERT INTO locker_accounts(group_id, assignment_type, occupants, payer, created_by, created_at) VALUES(?,?,?,?,?,?)')
      .run(g.id, type, occupants, payer, req.user.username, now()).lastInsertRowid);
    db.prepare('INSERT INTO locker_assignments(account_id, locker_id, group_id, issued_at, issued_by) VALUES(?,?,?,?,?)').run(acc, lockerId, g.id, now(), req.user.username);
    db.prepare('UPDATE lockers SET locker_status = ? WHERE id = ?').run(type === 'Shared' ? 'Shared' : 'Assigned', lockerId);
    audit(req.user, 'locker.assign', 'day_tour_group', g.id, { to: { locker: lockerId, type, occupants } });
    audit(req.user, 'locker.assign', 'locker', lockerId, { from: 'Available', to: type === 'Shared' ? 'Shared' : 'Assigned', reason: g.reference });
    return acc;
  });
  res.json({ ...groupDetail(g.id), account_id: out });
});

function loadAccount(id) {
  const a = db.prepare('SELECT * FROM locker_accounts WHERE id = ?').get(id);
  if (!a) throw notFound('Locker account');
  return a;
}

dayTourRouter.put('/locker-accounts/:id', requirePerm('daytour'), (req, res) => {
  const a = loadAccount(req.params.id);
  const payer = req.body.payer ? oneOf(req.body.payer, PAYERS, 'Payer') : a.payer;
  const occupants = req.body.occupants !== undefined ? str(req.body.occupants, 'Occupants') : a.occupants;
  db.prepare('UPDATE locker_accounts SET payer = ?, occupants = ? WHERE id = ?').run(payer, occupants, a.id);
  audit(req.user, 'locker.account_update', 'day_tour_group', a.group_id, { from: { payer: a.payer, occupants: a.occupants }, to: { payer, occupants } });
  res.json(groupDetail(a.group_id));
});

/** Return key: checked against the assignment, then the balance. Returned but unpaid stays unavailable. */
dayTourRouter.post('/locker-accounts/:id/return-key', requirePerm('daytour'), (req, res) => {
  const a = loadAccount(req.params.id);
  const asg = openAssignment(a.id);
  if (!asg || asg.key_returned_at) throw conflict('No key is outstanding on this locker account.');
  if (req.body.locker_id && String(req.body.locker_id).toUpperCase() !== asg.locker_id) throw conflict(`Key mismatch: this account holds ${asg.locker_id}.`);
  tx(() => {
    db.prepare('UPDATE locker_assignments SET key_returned_at = ?, key_returned_by = ? WHERE id = ?').run(now(), req.user.username, asg.id);
    const g = loadGroup(a.group_id);
    if (g.group_status === 'Arrived / Active') {
      db.prepare("UPDATE day_tour_groups SET group_status = 'Settling' WHERE id = ?").run(g.id);
      audit(req.user, 'daytour.settling', 'day_tour_group', g.id, { from: 'Arrived / Active', to: 'Settling', reason: 'First key returned' });
    }
    const cleared = clearLockerIfDone(req.user, a.id);
    audit(req.user, 'locker.return_key', 'day_tour_group', a.group_id, { to: { locker: asg.locker_id, status: cleared ? 'Available' : 'Key Returned - Unsettled' } });
  });
  res.json(groupDetail(a.group_id));
});

/** Lost key: penalty within the configured range (OD-14); locker unavailable until security/replacement decision. */
dayTourRouter.post('/locker-accounts/:id/lost-key', requirePerm('daytour'), (req, res) => {
  const a = loadAccount(req.params.id);
  const asg = openAssignment(a.id);
  if (!asg || asg.key_returned_at) throw conflict('No key is outstanding on this locker account.');
  const min = getSetting('lost_key_penalty_min', 50000);
  const max = getSetting('lost_key_penalty_max', 100000);
  const penalty = money(req.body.penalty, 'Penalty', { allowZero: false });
  if (penalty < min || penalty > max) throw bad(`Penalty must be between ${(min / 100).toFixed(2)} and ${(max / 100).toFixed(2)}.`);
  const note = str(req.body.note, 'Incident note');
  tx(() => {
    db.prepare('INSERT INTO locker_incidents(locker_id, account_id, group_id, type, penalty, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(asg.locker_id, a.id, a.group_id, 'lost', penalty, note, req.user.username, now());
    db.prepare(`INSERT INTO group_charges(group_id, locker_account_id, kind, description, qty, rate, amount, reason, created_by, created_at) VALUES(?,?, 'penalty', ?, 1, ?, ?, ?, ?, ?)`)
      .run(a.group_id, a.id, `Lost key penalty ${asg.locker_id}`, penalty, penalty, note, req.user.username, now());
    db.prepare("UPDATE locker_assignments SET ended_at = ?, ended_by = ?, end_reason = 'lost' WHERE id = ?").run(now(), req.user.username, asg.id);
    db.prepare("UPDATE lockers SET locker_status = 'Lost', status_note = ? WHERE id = ?").run(note, asg.locker_id);
    audit(req.user, 'locker.lost_key', 'day_tour_group', a.group_id, { to: { locker: asg.locker_id, penalty }, reason: note });
    audit(req.user, 'locker.lost_key', 'locker', asg.locker_id, { to: 'Lost', reason: note });
  });
  res.json(groupDetail(a.group_id));
});

/** Faulty locker: guest moves to another locker; unpaid charges move with the account (not a new sale). */
dayTourRouter.post('/locker-accounts/:id/transfer', requirePerm('daytour'), (req, res) => {
  const a = loadAccount(req.params.id);
  const asg = openAssignment(a.id);
  if (!asg || asg.key_returned_at) throw conflict('This locker account has no active key.');
  const toId = str(req.body.to_locker_id, 'Replacement locker').toUpperCase();
  const note = str(req.body.note, 'Fault description');
  tx(() => {
    const to = lockerInfo(toId);
    if (!to) throw bad(`Locker ${toId} does not exist.`);
    if (to.locker_status !== 'Available' || to.assignment) throw conflict(`Locker ${toId} is not available.`);
    db.prepare("UPDATE locker_assignments SET ended_at = ?, ended_by = ?, end_reason = 'faulty' WHERE id = ?").run(now(), req.user.username, asg.id);
    db.prepare("UPDATE lockers SET locker_status = 'Under Repair', status_note = ? WHERE id = ?").run(note, asg.locker_id);
    db.prepare('INSERT INTO locker_assignments(account_id, locker_id, group_id, issued_at, issued_by) VALUES(?,?,?,?,?)').run(a.id, toId, a.group_id, now(), req.user.username);
    db.prepare('UPDATE lockers SET locker_status = ? WHERE id = ?').run(a.assignment_type === 'Shared' ? 'Shared' : 'Assigned', toId);
    db.prepare('INSERT INTO locker_incidents(locker_id, account_id, group_id, type, note, moved_to_locker_id, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(asg.locker_id, a.id, a.group_id, 'faulty', note, toId, req.user.username, now());
    audit(req.user, 'locker.transfer', 'day_tour_group', a.group_id, { from: asg.locker_id, to: toId, reason: note });
    audit(req.user, 'locker.under_repair', 'locker', asg.locker_id, { to: 'Under Repair', reason: note });
  });
  res.json(groupDetail(a.group_id));
});

/** Security / maintenance decision: return a Lost or Under Repair locker to service. */
dayTourRouter.post('/lockers/:id/release', requirePerm('approve'), (req, res) => {
  const l = lockerInfo(String(req.params.id).toUpperCase());
  if (!l) throw notFound('Locker');
  if (!['Lost', 'Under Repair'].includes(l.locker_status)) throw conflict('Only Lost or Under Repair lockers can be released.');
  if (l.assignment) throw conflict('Locker still has an open assignment.');
  const note = str(req.body.note, 'Decision note (key replaced / repaired)');
  db.prepare("UPDATE lockers SET locker_status = 'Available', status_note = NULL WHERE id = ?").run(l.id);
  audit(req.user, 'locker.release', 'locker', l.id, { from: l.locker_status, to: 'Available', reason: note });
  res.json({ locker: lockerInfo(l.id) });
});

// ---------------------------------------------------------------------
// Cutover opening record (Part 3 s5, phase 2): future group bookings and any group still on site,
// with its locker assignments and balances, entered by hand. Nothing is recorded twice.
// ---------------------------------------------------------------------
dayTourRouter.post('/opening', requirePerm('approve'), (req, res) => {
  const b = req.body;
  const onSite = !!b.on_site;
  const group_name = str(b.group_name, 'Group / organizer name');
  const contact_no = str(b.contact_no, 'Contact number', { max: 40 });
  const ref = str(b.legacy_ref, 'Old system reference');
  const arrival_date = onSite ? today() : b.arrival_date;
  if (!isDate(arrival_date) || arrival_date < today()) throw bad('A future booking needs an arrival date from today on.');
  const payment_terms = oneOf(b.payment_terms || 'Pay on arrival', getSetting('daytour_payment_terms', []), 'Payment terms');
  const rate_basis = oneOf(b.rate_basis || 'Standard walk-in rates', getSetting('daytour_rate_bases', []), 'Rate basis');
  const opening_paid = money(b.opening_paid ?? 0, 'Amount already received in the old system');
  const lockers = Array.isArray(b.lockers) ? b.lockers : [];
  if (!onSite && lockers.length) throw bad('Lockers are entered only for a group that is on site.');
  const id = tx(() => {
    const gid = Number(db.prepare('INSERT INTO guests(full_name, contact_no, created_at) VALUES(?,?,?)').run(group_name, contact_no, now()).lastInsertRowid);
    const reference = nextNo('daytour', 'DT-', 4);
    const id = Number(db.prepare(`INSERT INTO day_tour_groups(reference, organizer_guest_id, group_name, contact_no, booking_type, arrival_date, estimated_guests,
        rate_basis, agreement_ref, payment_terms, group_status, remarks, is_opening_record, created_by, created_at, arrived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
      .run(reference, gid, group_name, contact_no, onSite ? 'Walk-in' : 'Advance', arrival_date, int(b.estimated_guests ?? 0, 'Estimated guests'),
        rate_basis, b.agreement_ref || null, payment_terms, onSite ? 'Arrived / Active' : 'Advance Booking',
        `Cutover opening record. Old system ref ${ref}. ${b.remarks || ''}`.trim(), req.user.username, now(), onSite ? now() : null).lastInsertRowid);
    if (onSite) {
      let persons = 0;
      for (const r of currentRates(arrival_date).filter((x) => x.kind === 'guest')) {
        const n = int(b.counts?.[r.code] ?? 0, `${r.name} count`);
        db.prepare(`INSERT INTO group_guest_counts(group_id, category_code, category_name, counts_as_person, count, rate, rate_id) VALUES(?,?,?,?,?,?,?)`)
          .run(id, r.code, r.name, r.counts_as_person, n, r.amount, r.id);
        if (r.counts_as_person) persons += n;
      }
      if (persons < 1) throw bad('Enter the actual guest counts of the group on site.');
      db.prepare('UPDATE day_tour_groups SET actual_guests = ? WHERE id = ?').run(persons, id);
      for (const [i, l] of lockers.entries()) {
        const lockerId = str(l.locker_id, `Locker on line ${i + 1}`).toUpperCase();
        const info = lockerInfo(lockerId);
        if (!info) throw bad(`Locker ${lockerId} does not exist.`);
        if (info.locker_status !== 'Available' || info.assignment) throw conflict(`Locker ${lockerId} is not available.`);
        const type = oneOf(l.assignment_type || 'Individual', ['Individual', 'Shared'], 'Assignment type');
        const acc = Number(db.prepare('INSERT INTO locker_accounts(group_id, assignment_type, occupants, payer, created_by, created_at) VALUES(?,?,?,?,?,?)')
          .run(id, type, str(l.occupants, `Occupants of ${lockerId}`), oneOf(l.payer || 'Representative', PAYERS, 'Payer'), req.user.username, now()).lastInsertRowid);
        db.prepare('INSERT INTO locker_assignments(account_id, locker_id, group_id, issued_at, issued_by) VALUES(?,?,?,?,?)').run(acc, lockerId, id, now(), req.user.username);
        db.prepare('UPDATE lockers SET locker_status = ? WHERE id = ?').run(type === 'Shared' ? 'Shared' : 'Assigned', lockerId);
        const bal = money(l.opening_balance ?? 0, `Opening balance of ${lockerId}`);
        if (bal > 0) db.prepare(`INSERT INTO group_charges(group_id, locker_account_id, kind, description, qty, rate, amount, reason, created_by, created_at) VALUES(?,?,'opening',?,1,?,?,?,?,?)`)
          .run(id, acc, `Opening balance from old system (${ref})`, bal, bal, 'Cutover', req.user.username, now());
      }
    }
    if (opening_paid > 0) {
      const t = groupTotals(id);
      if (onSite && opening_paid > t.entrance) throw bad('Amount already received is more than the entrance charges.');
      recordPayment(req.user, {
        kind: 'opening', accountType: 'group', accountId: id, purpose: 'Opening balance', note: `Received before cutover, ref ${ref}`, issueReceipt: false,
        tenders: [{ method: 'Opening balance (old system)', amount: opening_paid, reference: ref }],
        allocations: [{ target_type: 'group', target_id: id, amount: opening_paid }],
      });
    }
    audit(req.user, 'daytour.opening_record', 'day_tour_group', id, { to: { reference, onSite, ref, opening_paid, lockers: lockers.map((l) => l.locker_id) } });
    return id;
  });
  res.json(groupDetail(id));
});

/**
 * Approved discount line on the group account or a locker account. Senior / PWD needs a verified ID;
 * the amount follows the approved formula, which is still TO CONFIRM (OD-09, 10, 12). Original amounts stay separate.
 */
dayTourRouter.post('/groups/:id/discounts', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (!ON_SITE.includes(g.group_status)) throw conflict('Discounts are recorded while the group is on site.');
  const target_type = oneOf(req.body.target_type || 'group', ['group', 'locker_account'], 'Account');
  let target_id = g.id;
  let balance = groupTotals(g.id).groupAccountBalance;
  if (target_type === 'locker_account') {
    const acc = db.prepare('SELECT * FROM locker_accounts WHERE id = ? AND group_id = ?').get(req.body.target_id, g.id);
    if (!acc) throw bad('Locker account is not part of this group.');
    target_id = acc.id;
    balance = lockerAccountBalance(acc.id).balance;
  }
  const category = str(req.body.category, 'Discount category');
  const amount = money(req.body.amount, 'Discount amount', { allowZero: false });
  const reason = str(req.body.reason, 'Reason / ID reference');
  if (/senior|pwd/i.test(category) && !req.body.id_verified) throw bad('A Senior Citizen / PWD discount needs the ID verified first.');
  if (amount > balance) throw bad('Discount is larger than the account balance.');
  const approver = verifyApproval(req, req.body.approval, 'A discount');
  db.prepare(`INSERT INTO discount_lines(target_type, target_id, category, basis, vat_treatment, amount, reason, approver, id_verified, created_by, created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(target_type, target_id, category, req.body.basis || null, req.body.vat_treatment || null, amount, reason, approver, req.body.id_verified ? 1 : 0, req.user.username, now());
  audit(req.user, 'daytour.discount', 'day_tour_group', g.id, { to: { target_type, target_id, category, amount }, reason, approver });
  res.json(groupDetail(g.id));
});

/**
 * Deposit treatment for a cancelled advance booking, or a credit left after checkout (Part 3 s2.1: "Deposit treatment
 * follows management rules", OD-03 pattern). A separate, supervisor-approved transaction; history is kept.
 */
dayTourRouter.post('/groups/:id/refund-decision', requirePerm('daytour'), (req, res) => {
  const g = loadGroup(req.params.id);
  if (!['Cancelled', 'Checked Out'].includes(g.group_status)) throw conflict('Refund decisions apply to cancelled or checked-out groups.');
  if (g.refund_decision) throw conflict('A decision was already recorded.');
  const credit = -groupTotals(g.id).outstanding;
  if (credit <= 0) throw conflict('There is no deposit or credit to decide on.');
  const decision = oneOf(req.body.decision, ['No Refund', 'Refund Completed'], 'Decision');
  const reason = str(req.body.reason, 'Reason');
  const approver = verifyApproval(req, req.body.approval, 'A refund decision');
  tx(() => {
    if (decision === 'Refund Completed') {
      const amount = money(req.body.amount, 'Refund amount', { allowZero: false });
      if (amount > credit) throw bad('Refund cannot exceed the deposit / credit.');
      if (!getSetting('payment_methods', []).includes(req.body.method)) throw bad('Choose the refund method.');
      recordPayment(req.user, {
        kind: 'refund', accountType: 'group', accountId: g.id, purpose: 'Refund', note: reason, issueReceipt: false,
        tenders: [{ method: req.body.method, amount: -amount, reference: req.body.reference || null }],
        allocations: [{ target_type: 'group', target_id: g.id, amount: -amount }],
      });
    } else {
      // Forfeit: the deposit is kept as income; a forfeiture line brings the group account to zero.
      db.prepare(`INSERT INTO group_charges(group_id, kind, description, qty, rate, amount, reason, approver, created_by, created_at) VALUES(?, 'forfeit', 'Deposit forfeited', 1, ?, ?, ?, ?, ?, ?)`)
        .run(g.id, credit, credit, reason, approver, req.user.username, now());
    }
    db.prepare('UPDATE day_tour_groups SET refund_decision = ?, refund_note = ?, refund_approver = ? WHERE id = ?').run(decision, reason, approver, g.id);
    audit(req.user, 'daytour.refund_decision', 'day_tour_group', g.id, { to: decision, reason, approver });
  });
  res.json(groupDetail(g.id));
});
