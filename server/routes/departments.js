// Department charge bridge (Part 1 Fig. 2 flows 2-5) and receipts (Part 2 Fig. 6).
// Direct payment: receipted by the department, marked Paid, NOT posted to the folio.
// Charge to Room / Locker / Group: posts once, keyed by a unique source transaction ID (idempotent).
import express from 'express';
import { db } from '../db.js';
import {
  authenticate, requirePerm, can, bad, notFound, conflict, str, int, money, now, audit, tx, nextNo, getSetting,
  verifyApproval, DEPARTMENT_OF_ROLE, oneOf, isDate, dayStartIso, dayEndIso,
} from '../lib.js';
import { saveAttachment } from './reservations.js';
import { refreshReservationStatus, lockerAccountBalance, openAssignment, reservationTotals, groupTotals } from '../domain.js';

export const departmentsRouter = express.Router();
departmentsRouter.use(authenticate);

const DEPARTMENTS = { Restaurant: 'RST-', 'Mini Bar': 'MNB-', Massage: 'MSG-' };

function departmentFor(req, requested) {
  const own = DEPARTMENT_OF_ROLE[req.user.role];
  if (own) {
    if (requested && requested !== own) throw bad(`You can only post ${own} transactions.`);
    return own;
  }
  return oneOf(requested, Object.keys(DEPARTMENTS), 'Department');
}

/** Resolves Charge to Room / Locker / Group into a Front Office account. */
function resolveTarget(target) {
  if (!target?.type) throw bad('Choose where to charge: Room, Locker or Group.');
  if (target.type === 'room') {
    const roomNo = str(target.room_no, 'Room number').toUpperCase();
    const row = db.prepare(`SELECT s.line_id, l.reservation_id, rm.room_no, res.reference, g.full_name FROM guest_stays s
        JOIN reservation_room_lines l ON l.id = s.line_id JOIN rooms rm ON rm.id = s.room_id
        JOIN reservations res ON res.id = l.reservation_id JOIN guests g ON g.id = res.guest_id
        WHERE rm.room_no = ? AND s.occupancy_status = 'Checked In'`).get(roomNo);
    if (!row) throw conflict(`Room ${roomNo} has no checked-in guest. Charge to Room is not possible.`);
    return { target_type: 'reservation', target_id: row.reservation_id, target_line_id: row.line_id, target_label: `ROOM ${row.room_no} / ${row.reference} ${row.full_name}` };
  }
  if (target.type === 'locker') {
    const lockerId = str(target.locker_id, 'Locker ID').toUpperCase();
    const a = db.prepare(`SELECT a.*, g.reference, g.group_name, g.group_status FROM locker_assignments a JOIN day_tour_groups g ON g.id = a.group_id
                          WHERE a.locker_id = ? AND a.ended_at IS NULL`).get(lockerId);
    if (!a) throw conflict(`Locker ${lockerId} is not assigned to any group. Charge to Locker is not possible.`);
    if (a.key_returned_at) throw conflict(`Locker ${lockerId} key was already returned.`);
    return { target_type: 'locker_account', target_id: a.account_id, target_line_id: null, target_label: `LOCKER ${lockerId} / ${a.reference} ${a.group_name}` };
  }
  if (target.type === 'group') {
    const g = db.prepare('SELECT * FROM day_tour_groups WHERE reference = ?').get(str(target.group_ref, 'Group reference').toUpperCase());
    if (!g || !['Arrived / Active', 'Settling'].includes(g.group_status)) throw conflict('Group not found or not on site.');
    return { target_type: 'group', target_id: g.id, target_line_id: null, target_label: `GROUP ${g.reference} ${g.group_name}` };
  }
  throw bad('Unknown charge target.');
}

function refreshTarget(user, t) {
  if (t.target_type === 'reservation') refreshReservationStatus(t.target_id);
}

function parseItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one item.');
  return items.map((it, i) => {
    const name = str(it.name, `Item ${i + 1}`);
    const qty = int(it.qty, `Quantity of ${name}`, { min: 1 });
    const price = money(it.price, `Price of ${name}`, { allowZero: false });
    return { name, qty, price, amount: qty * price };
  });
}

const view = (d) => ({ ...d, items: JSON.parse(d.items) });

/**
 * Post a department transaction. Also the integration endpoint for external POS systems during
 * parallel running: send your own `source_txn_id`; a retry with the same ID never posts twice.
 */
departmentsRouter.post('/transactions', requirePerm('department'), (req, res) => {
  const b = req.body;
  const department = departmentFor(req, b.department);
  const method = oneOf(b.method, ['direct', 'charge'], 'Method');
  const items = parseItems(b.items);
  const amount = items.reduce((s, x) => s + x.amount, 0);
  if (b.source_txn_id) {
    const existing = db.prepare('SELECT * FROM department_transactions WHERE source_txn_id = ?').get(String(b.source_txn_id));
    if (existing) {
      if (existing.amount === amount && existing.method === method) return res.json({ transaction: view(existing), duplicate: true });
      throw conflict(`Source transaction ${b.source_txn_id} was already posted with different details.`);
    }
  }
  const out = tx(() => {
    let t = { target_type: null, target_id: null, target_line_id: null, target_label: null };
    let direct_tender = null;
    if (method === 'charge') t = resolveTarget(b.target);
    else {
      direct_tender = str(b.direct_tender, 'Payment method');
      if (!getSetting('payment_methods', []).includes(direct_tender)) throw bad('Payment method not enabled.');
    }
    const source_txn_id = b.source_txn_id ? str(b.source_txn_id, 'Source transaction ID', { max: 60 }) : nextNo(`dept:${department}`, DEPARTMENTS[department], 6);
    const id = Number(db.prepare(`INSERT INTO department_transactions(source_txn_id, department, method, target_type, target_id, target_line_id, target_label,
        items, amount, direct_tender, direct_reference, employee, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(source_txn_id, department, method, t.target_type, t.target_id, t.target_line_id, t.target_label, JSON.stringify(items), amount,
        direct_tender, b.direct_reference || null, req.user.username, b.note || null, now()).lastInsertRowid);
    // Flow 3: the physical charge bill is attached (photo / scan) or referenced by the slip number.
    if (b.bill_file) {
      const att = saveAttachment(req.user, { entity: 'department_transaction', entity_id: id, kind: 'charge_bill', file: b.bill_file });
      db.prepare('UPDATE department_transactions SET attachment_id = ? WHERE id = ?').run(att, id);
    }
    refreshTarget(req.user, t);
    audit(req.user, `department.${method}`, 'department_transaction', source_txn_id, { to: { department, amount, target: t.target_label, direct_tender } });
    return db.prepare('SELECT * FROM department_transactions WHERE id = ?').get(id);
  });
  res.json({ transaction: view(out), duplicate: false });
});

departmentsRouter.get('/transactions', requirePerm('department', 'frontdesk', 'reports'), (req, res) => {
  const own = DEPARTMENT_OF_ROLE[req.user.role];
  const dept = own || req.query.department || null;
  const from = isDate(req.query.from) ? dayStartIso(req.query.from) : null;
  const to = isDate(req.query.to) ? dayEndIso(req.query.to) : null;
  const rows = db.prepare(`SELECT * FROM department_transactions WHERE (? IS NULL OR department = ?)
                           AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?) ORDER BY id DESC LIMIT 300`)
    .all(dept, dept, from, from, to, to);
  res.json({ transactions: rows.map(view) });
});

departmentsRouter.get('/transactions/:id', requirePerm('department', 'frontdesk', 'reports'), (req, res) => {
  const d = db.prepare('SELECT * FROM department_transactions WHERE id = ? OR source_txn_id = ?').get(req.params.id, req.params.id);
  if (!d) throw notFound('Transaction');
  let settled = false;
  if (d.method === 'charge') {
    if (d.target_type === 'reservation') settled = reservationTotals(d.target_id).outstanding <= 0;
    if (d.target_type === 'locker_account') settled = lockerAccountBalance(d.target_id).balance <= 0;
    if (d.target_type === 'group') settled = groupTotals(d.target_id).groupAccountBalance <= 0;
  }
  res.json({ transaction: view(d), settled, settings: { business_name: getSetting('business_name') } });
});

/** A posted charge is corrected with a reversing transaction, never deleted. */
departmentsRouter.post('/transactions/:id/void', requirePerm('department', 'frontdesk'), (req, res) => {
  const d = db.prepare('SELECT * FROM department_transactions WHERE id = ?').get(req.params.id);
  if (!d) throw notFound('Transaction');
  if (d.reverses_txn_id || d.amount < 0) throw conflict('A reversal cannot be voided.');
  if (db.prepare('SELECT 1 FROM department_transactions WHERE reverses_txn_id = ?').get(d.source_txn_id)) throw conflict('Already voided.');
  const own = DEPARTMENT_OF_ROLE[req.user.role];
  if (own && own !== d.department) throw bad('Not your department.');
  const reason = str(req.body.reason, 'Reason');
  const approver = verifyApproval(req, req.body.approval, 'Voiding a department transaction');
  const out = tx(() => {
    const items = JSON.parse(d.items).map((i) => ({ ...i, amount: -i.amount }));
    db.prepare(`INSERT INTO department_transactions(source_txn_id, department, method, target_type, target_id, target_line_id, target_label, items, amount,
        direct_tender, employee, note, reverses_txn_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`${d.source_txn_id}-VOID`, d.department, d.method, d.target_type, d.target_id, d.target_line_id, d.target_label, JSON.stringify(items), -d.amount,
        d.direct_tender, req.user.username, reason, d.source_txn_id, now());
    refreshTarget(req.user, d);
    audit(req.user, 'department.void', 'department_transaction', d.source_txn_id, { from: d.amount, to: 'reversed', reason, approver });
    return db.prepare('SELECT * FROM department_transactions WHERE source_txn_id = ?').get(`${d.source_txn_id}-VOID`);
  });
  res.json({ transaction: view(out) });
});

/** Attach the signed charge bill after posting (e.g. once the guest has signed the printed slip). */
departmentsRouter.post('/transactions/:id/attachment', requirePerm('department', 'frontdesk'), (req, res) => {
  const d = db.prepare('SELECT * FROM department_transactions WHERE id = ?').get(req.params.id);
  if (!d) throw notFound('Transaction');
  const own = DEPARTMENT_OF_ROLE[req.user.role];
  if (own && own !== d.department) throw bad('Not your department.');
  const att = saveAttachment(req.user, { entity: 'department_transaction', entity_id: d.id, kind: 'charge_bill', file: req.body.file });
  db.prepare('UPDATE department_transactions SET attachment_id = ? WHERE id = ?').run(att, d.id);
  audit(req.user, 'department.bill_attached', 'department_transaction', d.source_txn_id, { to: { attachment: att } });
  res.json({ transaction: view(db.prepare('SELECT * FROM department_transactions WHERE id = ?').get(d.id)) });
});

/** Charge targets for the department screen: in-house rooms, issued lockers, groups on site. */
departmentsRouter.get('/targets', requirePerm('department', 'frontdesk'), (_req, res) => {
  const rooms = db.prepare(`SELECT rm.room_no, res.reference, g.full_name FROM guest_stays s JOIN rooms rm ON rm.id = s.room_id
      JOIN reservation_room_lines l ON l.id = s.line_id JOIN reservations res ON res.id = l.reservation_id JOIN guests g ON g.id = res.guest_id
      WHERE s.occupancy_status = 'Checked In' ORDER BY rm.room_no`).all();
  const lockers = db.prepare(`SELECT a.locker_id, g.reference, g.group_name FROM locker_assignments a JOIN day_tour_groups g ON g.id = a.group_id
      WHERE a.ended_at IS NULL AND a.key_returned_at IS NULL ORDER BY a.locker_id`).all();
  const groups = db.prepare("SELECT reference, group_name FROM day_tour_groups WHERE group_status IN ('Arrived / Active','Settling') ORDER BY reference").all();
  res.json({ rooms, lockers, groups });
});

// ---------------------------------------------------------------------
// Payments & receipts
// ---------------------------------------------------------------------
export const paymentsRouter = express.Router();
paymentsRouter.use(authenticate);

paymentsRouter.get('/', requirePerm('frontdesk', 'reports'), (req, res) => {
  const from = isDate(req.query.from) ? dayStartIso(req.query.from) : '0000';
  const to = isDate(req.query.to) ? dayEndIso(req.query.to) : '9999';
  const rows = db.prepare(`SELECT p.*, r.receipt_no, r.doc_type, r.reprint_count FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
                           WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.id DESC LIMIT 500`).all(from, to);
  res.json({ payments: rows.map((p) => ({ ...p, account: accountLabel(p), tenders: db.prepare('SELECT method, amount, reference FROM payment_tenders WHERE payment_id = ?').all(p.id) })) });
});

function accountLabel(p) {
  if (p.account_type === 'reservation') {
    const r = db.prepare('SELECT r.reference, g.full_name FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = ?').get(p.account_id);
    return r ? { type: 'Room folio', ref: r.reference, name: r.full_name, link: `/reservations/${p.account_id}` } : null;
  }
  const g = db.prepare('SELECT reference, group_name FROM day_tour_groups WHERE id = ?').get(p.account_id);
  return g ? { type: 'Group Account', ref: g.reference, name: g.group_name, link: `/daytour/${p.account_id}` } : null;
}

/** Everything needed to print one receipt: settled lines with department source IDs, tender lines. */
function receiptData(paymentId) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!p) throw notFound('Payment');
  const receipt = db.prepare('SELECT * FROM receipts WHERE payment_id = ?').get(p.id);
  const tenders = db.prepare('SELECT method, amount, reference FROM payment_tenders WHERE payment_id = ?').all(p.id);
  const allocs = db.prepare('SELECT * FROM payment_allocations WHERE payment_id = ?').all(p.id);
  const lines = allocs.map((a) => {
    if (a.target_type === 'reservation') {
      const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(a.target_id);
      const t = reservationTotals(r.id);
      const rooms = db.prepare(`SELECT rm.room_no, l.rate_per_night FROM reservation_room_lines l JOIN rooms rm ON rm.id = l.room_id WHERE l.reservation_id = ? AND l.line_status != 'Cancelled'`).all(r.id);
      const sub = rooms.map((x) => ({ label: `Room ${x.room_no} ${t.nights}N x ${(x.rate_per_night / 100).toFixed(2)}`, amount: x.rate_per_night * t.nights }));
      for (const c of db.prepare('SELECT description, amount FROM folio_charges WHERE reservation_id = ?').all(r.id)) sub.push({ label: c.description, amount: c.amount });
      for (const d of db.prepare("SELECT department, source_txn_id, amount FROM department_transactions WHERE method='charge' AND target_type='reservation' AND target_id = ?").all(r.id))
        sub.push({ label: `${d.department} (${d.source_txn_id})`, amount: d.amount });
      for (const d of db.prepare("SELECT category, amount FROM discount_lines WHERE target_type='reservation' AND target_id = ?").all(r.id))
        sub.push({ label: `Less: ${d.category} discount`, amount: -d.amount });
      return { label: `Room folio ${r.reference} - ${p.purpose || 'Payment'}`, amount: a.amount, sub, account_total: t.total, paid_to_date: t.paid, balance: t.outstanding };
    }
    if (a.target_type === 'locker_account') {
      const asg = db.prepare('SELECT locker_id FROM locker_assignments WHERE account_id = ? ORDER BY id DESC').get(a.target_id);
      const sub = [];
      for (const d of db.prepare("SELECT department, source_txn_id, amount FROM department_transactions WHERE method='charge' AND target_type='locker_account' AND target_id = ?").all(a.target_id))
        sub.push({ label: `${d.department} (${d.source_txn_id})`, amount: d.amount });
      for (const c of db.prepare('SELECT description, amount FROM group_charges WHERE locker_account_id = ?').all(a.target_id)) sub.push({ label: c.description, amount: c.amount });
      for (const d of db.prepare("SELECT category, amount FROM discount_lines WHERE target_type='locker_account' AND target_id = ?").all(a.target_id)) sub.push({ label: `Less: ${d.category} discount`, amount: -d.amount });
      return { label: `Locker ${asg?.locker_id ?? a.target_id}`, amount: a.amount, sub };
    }
    // group account
    const sub = db.prepare('SELECT category_name, count, rate FROM group_guest_counts WHERE group_id = ? AND count > 0').all(a.target_id)
      .map((c) => ({ label: `${c.category_name} ${c.count} x ${(c.rate / 100).toFixed(2)}`, amount: c.count * c.rate }));
    for (const c of db.prepare('SELECT description, amount FROM group_charges WHERE group_id = ? AND locker_account_id IS NULL').all(a.target_id)) sub.push({ label: c.description, amount: c.amount });
    for (const d of db.prepare("SELECT department, source_txn_id, amount FROM department_transactions WHERE method='charge' AND target_type='group' AND target_id = ?").all(a.target_id))
      sub.push({ label: `${d.department} (${d.source_txn_id})`, amount: d.amount });
    for (const d of db.prepare("SELECT category, amount FROM discount_lines WHERE target_type='group' AND target_id = ?").all(a.target_id)) sub.push({ label: `Less: ${d.category} discount`, amount: -d.amount });
    return { label: 'Group account (entrance & facilities)', amount: a.amount, sub };
  });
  // Part 2 s5.1 #6: the Senior / PWD block is printed only when a verified claim exists on a settled account.
  const scpwd = [];
  for (const a of allocs) {
    for (const d of db.prepare("SELECT category, basis, vat_treatment, amount, approver FROM discount_lines WHERE target_type = ? AND target_id = ? AND id_verified = 1").all(a.target_type, a.target_id))
      if (/senior|pwd/i.test(d.category)) scpwd.push(d);
  }
  return {
    payment: p, receipt, tenders, lines, account: accountLabel(p), scpwd,
    settings: {
      business_name: getSetting('business_name'), business_address: getSetting('business_address'), business_tin: getSetting('business_tin'),
      terminal_id: getSetting('terminal_id'), receipt_footer: getSetting('receipt_footer'),
    },
  };
}

paymentsRouter.get('/:id/receipt', requirePerm('frontdesk', 'reports'), (req, res) => res.json(receiptData(req.params.id)));

/** Reprints print the word REPRINT and write an audit entry. */
paymentsRouter.post('/:id/print', requirePerm('frontdesk'), (req, res) => {
  const r = db.prepare('SELECT * FROM receipts WHERE payment_id = ?').get(req.params.id);
  if (!r) throw notFound('Receipt');
  const first = !r.last_printed_at;
  db.prepare(`UPDATE receipts SET reprint_count = reprint_count + ?, last_printed_at = ? WHERE id = ?`).run(first ? 0 : 1, now(), r.id);
  audit(req.user, first ? 'receipt.print' : 'receipt.reprint', 'receipt', r.receipt_no);
  res.json({ ...receiptData(req.params.id), reprint: !first });
});

void can;
