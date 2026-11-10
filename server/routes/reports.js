// Dashboard + operational/management reports, built from source transactions (Part 1 flow 10).
import express from 'express';
import { db } from '../db.js';
import { authenticate, requirePerm, can, isDate, today, dayStartIso, dayEndIso, getSetting, bad, now, audit } from '../lib.js';
import { reservationTotals, groupTotals, roomAvailabilityToday, roomReady } from '../domain.js';

export const reportsRouter = express.Router();
reportsRouter.use(authenticate);

reportsRouter.get('/dashboard', (req, res) => {
  const t = today();
  const out = { today: t };
  if (can(req.user, 'reservation.view') || can(req.user, 'frontdesk')) {
    const q = (sql, ...p) => db.prepare(sql).all(...p);
    out.arrivals = q(`SELECT r.id, r.reference, r.reservation_status, r.payment_status, g.full_name,
        (SELECT COUNT(*) FROM reservation_room_lines l WHERE l.reservation_id = r.id AND l.line_status = 'Active') AS pending_rooms
        FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.check_in = ? AND r.reservation_status IN ('Active / Booked','Checked In') ORDER BY r.reference`, t);
    out.departures = q(`SELECT r.id, r.reference, r.reservation_status, g.full_name FROM reservations r JOIN guests g ON g.id = r.guest_id
        WHERE r.check_out <= ? AND EXISTS (SELECT 1 FROM reservation_room_lines l WHERE l.reservation_id = r.id AND l.line_status = 'Checked In') ORDER BY r.check_out`, t);
    out.inhouse = db.prepare("SELECT COUNT(*) AS c FROM guest_stays WHERE occupancy_status = 'Checked In'").get().c;
    for (const a of out.arrivals) a.totals = reservationTotals(a.id);
    for (const d of out.departures) d.totals = reservationTotals(d.id);
  }
  const rooms = db.prepare('SELECT * FROM rooms WHERE active = 1').all();
  out.rooms = { total: rooms.length, hk: {}, availability: {} };
  for (const r of rooms) {
    out.rooms.hk[r.hk_status] = (out.rooms.hk[r.hk_status] || 0) + 1;
    const a = roomAvailabilityToday(r);
    out.rooms.availability[a] = (out.rooms.availability[a] || 0) + 1;
  }
  if (can(req.user, 'daytour.view')) {
    out.groups = db.prepare(`SELECT * FROM day_tour_groups WHERE (arrival_date = ? AND group_status != 'Cancelled') OR group_status IN ('Arrived / Active','Settling') ORDER BY id`).all(t)
      .map((g) => ({ ...g, totals: groupTotals(g.id) }));
    out.lockers = {};
    for (const r of db.prepare('SELECT locker_status, COUNT(*) AS c FROM lockers GROUP BY locker_status').all()) out.lockers[r.locker_status] = r.c;
  }
  if (can(req.user, 'frontdesk') || can(req.user, 'reports')) {
    out.collections_today = db.prepare(`SELECT t.method, SUM(t.amount) AS amount FROM payment_tenders t JOIN payments p ON p.id = t.payment_id
                                        WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY t.method`).all(dayStartIso(t), dayEndIso(t));
  }
  res.json(out);
});

reportsRouter.get('/summary', requirePerm('reports', 'frontdesk'), (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : today();
  const to = isDate(req.query.to) ? req.query.to : from;
  const a = dayStartIso(from);
  const b = dayEndIso(to);
  const byMethod = db.prepare(`SELECT t.method, COUNT(DISTINCT p.id) AS payments, SUM(t.amount) AS amount FROM payment_tenders t JOIN payments p ON p.id = t.payment_id
                               WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY t.method ORDER BY amount DESC`).all(a, b);
  const byCashier = db.prepare(`SELECT p.cashier, COUNT(*) AS payments, SUM(p.total) AS amount FROM payments p WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY p.cashier`).all(a, b);
  const byPurpose = db.prepare(`SELECT p.account_type, p.purpose, COUNT(*) AS payments, SUM(p.total) AS amount FROM payments p WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY p.account_type, p.purpose`).all(a, b);
  const dept = db.prepare(`SELECT department, method, COUNT(*) AS txns, SUM(amount) AS amount FROM department_transactions WHERE created_at >= ? AND created_at < ? GROUP BY department, method`).all(a, b);
  const discounts = db.prepare(`SELECT category, COUNT(*) AS lines, SUM(amount) AS amount FROM discount_lines WHERE created_at >= ? AND created_at < ? GROUP BY category`).all(a, b);
  const daytour = db.prepare(`SELECT c.category_name, SUM(c.count) AS count, SUM(c.count * c.rate) AS amount FROM group_guest_counts c JOIN day_tour_groups g ON g.id = c.group_id
                              WHERE g.arrival_date BETWEEN ? AND ? AND g.group_status != 'Cancelled' GROUP BY c.category_code ORDER BY MIN(c.id)`).all(from, to);
  const groups = db.prepare(`SELECT COUNT(*) AS groups, SUM(actual_guests) AS guests FROM day_tour_groups WHERE arrival_date BETWEEN ? AND ? AND group_status != 'Cancelled'`).get(from, to);
  const reservationsMade = db.prepare(`SELECT source, COUNT(*) AS count FROM reservations WHERE created_at >= ? AND created_at < ? GROUP BY source`).all(a, b);
  const cancellations = db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE cancelled_at >= ? AND cancelled_at < ?`).get(a, b).c;
  const transfers = db.prepare(`SELECT treatment, COUNT(*) AS count, SUM(upgrade_value) AS value FROM room_transfers WHERE created_at >= ? AND created_at < ? GROUP BY treatment`).all(a, b);
  const openFolios = db.prepare(`SELECT r.id, r.reference, r.reservation_status, g.full_name FROM reservations r JOIN guests g ON g.id = r.guest_id
      WHERE r.reservation_status IN ('Checked In','Checked Out','Cancelled')
         OR EXISTS (SELECT 1 FROM reservation_room_lines l WHERE l.reservation_id = r.id AND l.line_status = 'Checked In')`).all()
    // In-house folios with a balance, checked-out exceptions still owing, and cancelled deposits awaiting a refund decision.
    .map((r) => ({ ...r, outstanding: reservationTotals(r.id).outstanding }))
    .filter((r) => r.outstanding !== 0);
  const openGroups = db.prepare(`SELECT id, reference, group_name, group_status FROM day_tour_groups WHERE group_status IN ('Arrived / Active','Settling')`).all()
    .map((g) => ({ ...g, outstanding: groupTotals(g.id).outstanding }));
  const lockerIncidents = db.prepare(`SELECT type, COUNT(*) AS count, SUM(penalty) AS penalty FROM locker_incidents WHERE created_at >= ? AND created_at < ? GROUP BY type`).all(a, b);
  res.json({ from, to, byMethod, byCashier, byPurpose, dept, discounts, daytour, groups, reservationsMade, cancellations, transfers, openFolios, openGroups, lockerIncidents });
});

// ---------------------------------------------------------------------
// Daily reconciliation during parallel running (Part 1, Fixed decision 9; Part 3 s5 phase 4).
// IRMS figures are computed from source transactions; the old-system / department POS figure is typed in,
// the variance is shown, and the signed-off sheet is saved with the preparer.
// ---------------------------------------------------------------------
function systemLines(date) {
  const a = dayStartIso(date);
  const b = dayEndIso(date);
  const lines = [];
  for (const r of db.prepare(`SELECT t.method, SUM(t.amount) AS amount FROM payment_tenders t JOIN payments p ON p.id = t.payment_id
                              WHERE p.kind = 'payment' AND p.paid_at >= ? AND p.paid_at < ? GROUP BY t.method ORDER BY t.method`).all(a, b))
    lines.push({ key: `fo:${r.method}`, group: 'Front Office collections', label: r.method, system: r.amount });
  for (const m of getSetting('payment_methods', [])) if (!lines.find((l) => l.key === `fo:${m}`)) lines.push({ key: `fo:${m}`, group: 'Front Office collections', label: m, system: 0 });
  for (const dep of ['Restaurant', 'Mini Bar', 'Massage']) {
    const q = (where) => db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM department_transactions WHERE department = ? AND created_at >= ? AND created_at < ? AND ${where}`).get(dep, a, b).v;
    lines.push({ key: `dept:${dep}:direct`, group: dep, label: 'Direct sales (department receipt)', system: q("method = 'direct'") });
    lines.push({ key: `dept:${dep}:room`, group: dep, label: 'Charged to rooms', system: q("method = 'charge' AND target_type = 'reservation'") });
    lines.push({ key: `dept:${dep}:locker`, group: dep, label: 'Charged to lockers / groups', system: q("method = 'charge' AND target_type IN ('locker_account','group')") });
  }
  return lines;
}

reportsRouter.get('/reconciliation', requirePerm('reports', 'frontdesk'), (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const saved = db.prepare('SELECT * FROM reconciliations WHERE business_date = ? ORDER BY id DESC').all(date).map((r) => ({ ...r, lines: JSON.parse(r.lines) }));
  res.json({ date, lines: systemLines(date), saved });
});

reportsRouter.post('/reconciliation', requirePerm('reports', 'frontdesk'), (req, res) => {
  const date = req.body.business_date;
  if (!isDate(date)) throw bad('Choose the business date.');
  const sys = systemLines(date);
  const input = req.body.external || {};
  const lines = sys.map((l) => {
    const raw = input[l.key];
    const external = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    if (external !== null && !Number.isInteger(external)) throw bad(`Invalid amount for ${l.group} - ${l.label}.`);
    return { ...l, external, variance: external === null ? null : l.system - external, note: req.body.notes_by_line?.[l.key] || null };
  });
  if (!lines.some((l) => l.external !== null)) throw bad('Enter at least one figure from the old system or department POS.');
  const total = lines.reduce((s, l) => s + Math.abs(l.variance || 0), 0);
  const unexplained = lines.filter((l) => l.variance && !l.note);
  if (unexplained.length) throw bad(`Explain each variance: ${unexplained.map((l) => `${l.group} - ${l.label}`).join(', ')}.`);
  const id = db.prepare('INSERT INTO reconciliations(business_date, lines, notes, total_variance, prepared_by, prepared_at) VALUES(?,?,?,?,?,?)')
    .run(date, JSON.stringify(lines), req.body.notes || null, total, req.user.username, now()).lastInsertRowid;
  audit(req.user, 'reconciliation.save', 'reconciliation', Number(id), { to: { date, total_variance: total }, reason: req.body.notes });
  res.json({ id: Number(id) });
});

// ---------------------------------------------------------------------
// Notifications: things that need someone's attention now, filtered by role.
// Each alert has a stable key so the client can tell which ones are new.
// ---------------------------------------------------------------------
reportsRouter.get('/alerts', (req, res) => {
  const t = today();
  const out = [];
  const add = (key, level, text, link) => out.push({ key, level, text, link });

  if (can(req.user, 'approve')) {
    const n = db.prepare("SELECT COUNT(*) AS c FROM approval_requests WHERE status = 'Pending'").get().c;
    if (n) add(`approvals:${n}`, 'warn', `${n} approval request${n > 1 ? 's' : ''} waiting for you`, '/approvals');
  }
  if (can(req.user, 'frontdesk')) {
    // Guests waiting for a room (Check-in Pending): tell Front Office as soon as the room is ready.
    const waiting = db.prepare(`SELECT l.id, l.room_id, l.arrived_at, rm.room_no, r.id AS rid, g.full_name FROM reservation_room_lines l
        JOIN rooms rm ON rm.id = l.room_id JOIN reservations r ON r.id = l.reservation_id JOIN guests g ON g.id = r.guest_id
        WHERE l.line_status = 'Active' AND l.arrived_at IS NOT NULL`).all();
    for (const w of waiting) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(w.room_id);
      if (roomReady(room, w.id).ready) add(`ready:${w.id}`, 'success', `Room ${w.room_no} is ready for ${w.full_name} (waiting guest)`, `/reservations/${w.rid}/checkin`);
    }
    const stillWaiting = waiting.length - out.filter((a) => a.key.startsWith('ready:')).length;
    if (stillWaiting > 0) add(`waiting:${stillWaiting}`, 'info', `${stillWaiting} guest room${stillWaiting > 1 ? 's' : ''} still waiting for Housekeeping`, '/pending');
    const arrivals = db.prepare(`SELECT COUNT(DISTINCT r.id) AS c FROM reservations r JOIN reservation_room_lines l ON l.reservation_id = r.id
        WHERE r.check_in = ? AND l.line_status = 'Active'`).get(t).c;
    if (arrivals) add(`arrivals:${t}:${arrivals}`, 'info', `${arrivals} reservation${arrivals > 1 ? 's' : ''} arriving today not yet checked in`, '/');
    const due = db.prepare(`SELECT COUNT(DISTINCT r.id) AS c FROM reservations r JOIN reservation_room_lines l ON l.reservation_id = r.id
        WHERE r.check_out <= ? AND l.line_status = 'Checked In'`).get(t).c;
    if (due) add(`departures:${t}:${due}`, 'warn', `${due} stay${due > 1 ? 's' : ''} due to check out`, '/');
    for (const r of db.prepare("SELECT r.id, r.reference, g.full_name FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.payment_status = 'Adjustment Pending' LIMIT 10").all())
      add(`adjust:${r.id}`, 'warn', `${r.reference} ${r.full_name}: payment adjustment pending`, `/reservations/${r.id}`);
  }
  if (can(req.user, 'reservation.edit')) {
    const overdue = db.prepare("SELECT id FROM reservations WHERE reservation_status = 'Active / Booked' AND down_payment_due < ?").all(t)
      .filter((r) => reservationTotals(r.id).downPaymentOutstanding > 0).length;
    if (overdue) add(`dp:${t}:${overdue}`, 'warn', `${overdue} reservation${overdue > 1 ? 's' : ''} past the down payment due date`, '/followup');
  }
  if (can(req.user, 'daytour.view')) {
    const adv = db.prepare("SELECT COUNT(*) AS c FROM day_tour_groups WHERE group_status = 'Advance Booking' AND arrival_date = ?").get(t).c;
    if (adv) add(`dtadv:${t}:${adv}`, 'info', `${adv} Day Tour advance booking${adv > 1 ? 's' : ''} arriving today`, '/daytour');
    const unsettled = db.prepare("SELECT COUNT(*) AS c FROM lockers WHERE locker_status = 'Key Returned - Unsettled'").get().c;
    if (unsettled) add(`lkunsettled:${unsettled}`, 'warn', `${unsettled} locker${unsettled > 1 ? 's' : ''} returned but still unpaid`, '/lockers');
    const settling = db.prepare("SELECT COUNT(*) AS c FROM day_tour_groups WHERE group_status = 'Settling'").get().c;
    if (settling) add(`settling:${settling}`, 'info', `${settling} Day Tour group${settling > 1 ? 's' : ''} settling`, '/daytour');
  }
  if (can(req.user, 'housekeeping')) {
    const urgent = db.prepare(`SELECT DISTINCT rm.room_no FROM rooms rm JOIN reservation_room_lines l ON l.room_id = rm.id JOIN reservations r ON r.id = l.reservation_id
        WHERE l.line_status = 'Active' AND r.check_in <= ? AND rm.hk_status != 'Clean'`).all(t).map((x) => x.room_no);
    if (urgent.length) add(`hkurgent:${urgent.join(',')}`, 'warn', `Arriving guests need room${urgent.length > 1 ? 's' : ''} ${urgent.join(', ')} cleaned`, '/rooms');
  }
  if (can(req.user, 'hk.supervise')) {
    const insp = db.prepare("SELECT COUNT(*) AS c FROM rooms WHERE hk_status = 'For Inspection' AND active = 1").get().c;
    if (insp) add(`insp:${insp}`, 'info', `${insp} room${insp > 1 ? 's' : ''} waiting for inspection`, '/rooms');
  }
  res.json({ alerts: out });
});
