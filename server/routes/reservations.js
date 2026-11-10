// Room reservations (Part 1 Fig. 3), check-in (Part 2 Fig. 1), room transfer (Part 1 Fig. 5, Part 2 Figs. 2-3),
// folio, cashier payments and check-out (Part 1 s5.2).
import express from 'express';
import { consumeApproval } from './approvals.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOAD_DIR } from '../db.js';
import {
  authenticate, requirePerm, can, bad, notFound, conflict, HttpError, str, int, money, isDate, today, now, addDays,
  nightsBetween, maxDate, audit, tx, nextNo, getSetting, verifyApproval, oneOf,
} from '../lib.js';
import {
  assertRoomFree, roomReady, reservationTotals, refreshReservationStatus, recordPayment, validateTenders,
  setHkStatus, setBlock, occupyingStay,
} from '../domain.js';

export const reservationsRouter = express.Router();
reservationsRouter.use(authenticate);

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function load(id) {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!r) throw notFound('Reservation');
  return r;
}
function loadLine(r, lineId) {
  const l = db.prepare('SELECT * FROM reservation_room_lines WHERE id = ? AND reservation_id = ?').get(lineId, r.id);
  if (!l) throw notFound('Room line');
  return l;
}
const roomById = (id) => db.prepare('SELECT r.*, t.name AS category, t.rate_per_night AS type_rate FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE r.id = ?').get(id);

export function saveAttachment(user, { entity, entity_id, kind, file, restricted = 0 }) {
  if (!file?.data || !file?.filename) throw bad('Attach a file.');
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.mime)) throw bad('Only JPG, PNG, WEBP or PDF files are accepted.');
  const buf = Buffer.from(String(file.data).replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length > 8 * 1024 * 1024) throw bad('File is larger than 8 MB.');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[file.mime];
  const name = `${entity}-${entity_id}-${kind}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  const id = db.prepare('INSERT INTO attachments(entity, entity_id, kind, filename, mime, path, restricted, uploaded_by, uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(entity, entity_id, kind, String(file.filename).slice(0, 120), file.mime, name, restricted, user.username, now()).lastInsertRowid;
  audit(user, 'attachment.upload', entity, entity_id, { to: { kind, filename: file.filename } });
  return Number(id);
}

function parseLine(l, i) {
  const room = roomById(int(l.room_id, `Room on line ${i + 1}`, { min: 1 }));
  if (!room) throw bad(`Room on line ${i + 1} not found.`);
  const counts = {
    adults: int(l.adults ?? 0, 'Adults'), children: int(l.children ?? 0, 'Children'),
    seniors: int(l.seniors ?? 0, 'Senior'), pwd: int(l.pwd ?? 0, 'PWD'),
  };
  if (counts.adults + counts.children + counts.seniors + counts.pwd < 1) throw bad(`Room ${room.room_no}: enter at least one guest.`);
  const rate = l.rate_per_night === undefined || l.rate_per_night === null || l.rate_per_night === '' ? room.type_rate : money(l.rate_per_night, `Rate for ${room.room_no}`, { allowZero: false });
  return { id: l.id ? Number(l.id) : null, room, rate, ...counts };
}

function validateDates(check_in, check_out, { allowPast = false } = {}) {
  if (!isDate(check_in) || !isDate(check_out)) throw bad('Enter check-in and check-out dates.');
  if (check_out <= check_in) throw bad('Check-out must be after check-in.');
  if (!allowPast && check_in < today()) throw bad('Check-in date cannot be in the past.');
}

export function reservationDetail(id) {
  const r = load(id);
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(r.guest_id);
  const lines = db.prepare(`SELECT l.*, rm.room_no, rm.hk_status, rm.block_status, t.name AS category,
                              s.id AS stay_id, s.occupancy_status, s.checked_in_at, s.checked_in_by, s.checked_out_at, s.inspection_note, s.checkin_exception
                            FROM reservation_room_lines l JOIN room_types t ON t.id = l.room_type_id
                            LEFT JOIN rooms rm ON rm.id = l.room_id LEFT JOIN guest_stays s ON s.line_id = l.id
                            WHERE l.reservation_id = ? ORDER BY l.id`).all(id)
    .map((l) => {
      const room = l.room_id ? roomById(l.room_id) : null;
      const rd = room ? roomReady(room, l.id) : { ready: false, why: 'No room assigned' };
      const needTick = getSetting('fo_confirms_housekeeping', true);
      return {
        ...l, ready: rd.ready && (!needTick || !!l.hk_confirmed_at), room_ready: rd.ready, ready_why: rd.why, hk_tick_required: needTick,
        occupancy_status: l.occupancy_status || 'Not Arrived',
        // Part 1 s5.1: guest arrived but room not ready -> Occupancy Not Arrived, Stay Check-in Pending.
        stay_status: l.line_status === 'Active' && l.arrived_at ? 'Check-in Pending' : null,
      };
    });
  const totals = reservationTotals(id);
  const charges = db.prepare('SELECT f.*, rm.room_no FROM folio_charges f LEFT JOIN reservation_room_lines l ON l.id = f.line_id LEFT JOIN rooms rm ON rm.id = l.room_id WHERE f.reservation_id = ? ORDER BY f.id').all(id);
  const dept = db.prepare(`SELECT d.*, rm.room_no FROM department_transactions d LEFT JOIN reservation_room_lines l ON l.id = d.target_line_id LEFT JOIN rooms rm ON rm.id = l.room_id
                           WHERE d.method = 'charge' AND d.target_type = 'reservation' AND d.target_id = ? ORDER BY d.id`).all(id)
    .map((d) => ({ ...d, items: JSON.parse(d.items) }));
  const discounts = db.prepare("SELECT * FROM discount_lines WHERE target_type = 'reservation' AND target_id = ? ORDER BY id").all(id);
  const payments = db.prepare(`SELECT p.*, rc.receipt_no, rc.doc_type, rc.reprint_count FROM payments p LEFT JOIN receipts rc ON rc.payment_id = p.id
                               WHERE p.account_type = 'reservation' AND p.account_id = ? ORDER BY p.id`).all(id)
    .map((p) => ({ ...p, tenders: db.prepare('SELECT method, amount, reference FROM payment_tenders WHERE payment_id = ?').all(p.id) }));
  const transfers = db.prepare(`SELECT tr.*, a.room_no AS from_room, b.room_no AS to_room FROM room_transfers tr
                                JOIN rooms a ON a.id = tr.from_room_id JOIN rooms b ON b.id = tr.to_room_id WHERE tr.reservation_id = ? ORDER BY tr.id`).all(id);
  const history = db.prepare("SELECT * FROM audit_events WHERE entity = 'reservation' AND entity_id = ? ORDER BY id DESC").all(String(id));
  return { reservation: r, guest, lines, totals, charges, dept, discounts, payments, transfers, history };
}

// ---------------------------------------------------------------------
// list & detail
// ---------------------------------------------------------------------
reservationsRouter.get('/', requirePerm('reservation.view'), (req, res) => {
  const where = [];
  const p = [];
  const q = (req.query.q || '').trim();
  if (q) { where.push('(r.reference LIKE ? OR g.full_name LIKE ? OR g.contact_no LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (req.query.status) { where.push('r.reservation_status = ?'); p.push(req.query.status); }
  if (isDate(req.query.arrival)) { where.push('r.check_in = ?'); p.push(req.query.arrival); }
  if (isDate(req.query.departure)) { where.push('r.check_out = ?'); p.push(req.query.departure); }
  if (req.query.view === 'inhouse') where.push("r.reservation_status IN ('Checked In','Active / Booked') AND EXISTS (SELECT 1 FROM reservation_room_lines x WHERE x.reservation_id = r.id AND x.line_status = 'Checked In')");
  // Part 1 Fig. 3: "Stays Active / Unpaid - room remains blocked, follow up with guest". Release rule is TO CONFIRM (OD-02).
  if (req.query.view === 'followup') where.push("r.reservation_status = 'Active / Booked' AND NOT EXISTS (SELECT 1 FROM reservation_room_lines x WHERE x.reservation_id = r.id AND x.line_status = 'Checked In')");
  if (req.query.view === 'pending') where.push("EXISTS (SELECT 1 FROM reservation_room_lines x WHERE x.reservation_id = r.id AND x.line_status = 'Active' AND x.arrived_at IS NOT NULL)");
  if (req.query.view === 'upcoming') { where.push("r.reservation_status = 'Active / Booked' AND r.check_out > ?"); p.push(today()); }
  const rows = db.prepare(`SELECT r.*, g.full_name, g.contact_no,
      (SELECT GROUP_CONCAT(COALESCE(rm.room_no, '?'), ', ') FROM reservation_room_lines l LEFT JOIN rooms rm ON rm.id = l.room_id WHERE l.reservation_id = r.id AND l.line_status != 'Cancelled') AS rooms
      FROM reservations r JOIN guests g ON g.id = r.guest_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.check_in DESC, r.id DESC LIMIT 300`).all(...p);
  let out = rows.map((r) => ({ ...r, totals: reservationTotals(r.id) }));
  if (req.query.view === 'followup') {
    out = out.filter((r) => r.totals.downPaymentOutstanding > 0)
      .map((r) => ({ ...r, overdue: !!r.down_payment_due && r.down_payment_due < today(),
        last_follow_up: db.prepare("SELECT at, username, reason FROM audit_events WHERE entity = 'reservation' AND entity_id = ? AND action = 'reservation.follow_up' ORDER BY id DESC").get(String(r.id)) || null }))
      .sort((a, b) => String(a.down_payment_due).localeCompare(String(b.down_payment_due)));
  }
  res.json({ reservations: out });
});

reservationsRouter.get('/:id', requirePerm('reservation.view'), (req, res) => res.json(reservationDetail(req.params.id)));

// ---------------------------------------------------------------------
// create (FO-RSV-01..04): saving blocks the rooms at once, payment not required
// ---------------------------------------------------------------------
reservationsRouter.post('/', requirePerm('reservation.edit'), (req, res) => {
  const b = req.body;
  validateDates(b.check_in, b.check_out);
  const source = str(b.source, 'Booking source');
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('Add at least one room.');
  const lines = b.lines.map(parseLine);
  if (new Set(lines.map((l) => l.room.id)).size !== lines.length) throw bad('The same room is listed twice.');
  const id = tx(() => {
    let guestId = b.guest_id ? Number(b.guest_id) : null;
    if (guestId && !db.prepare('SELECT 1 FROM guests WHERE id = ?').get(guestId)) throw bad('Guest not found.');
    if (!guestId) {
      guestId = Number(db.prepare('INSERT INTO guests(full_name, contact_no, email, created_at) VALUES(?,?,?,?)')
        .run(str(b.guest?.full_name, 'Guest name'), str(b.guest?.contact_no, 'Contact number', { max: 40 }), b.guest?.email || null, now()).lastInsertRowid);
    }
    const reference = nextNo('reservation', 'RSV-', 6);
    const pct = Number(getSetting('down_payment_pct', 30));
    const due = addDays(today(), Number(getSetting('down_payment_due_days', 3)));
    const rid = Number(db.prepare(`INSERT INTO reservations(reference, guest_id, source, check_in, check_out, reservation_status, payment_status,
        down_payment_pct, down_payment_due, remarks, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(reference, guestId, source, b.check_in, b.check_out, 'Active / Booked', 'Unpaid', pct, due < b.check_in ? due : b.check_in, b.remarks || null, req.user.username, now()).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO reservation_room_lines(reservation_id, room_type_id, room_id, rate_per_night, effective_rate, adults, children, seniors, pwd)
                            VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const l of lines) {
      assertRoomFree(l.room, b.check_in, b.check_out);
      ins.run(rid, l.room.room_type_id, l.room.id, l.rate, l.rate, l.adults, l.children, l.seniors, l.pwd);
    }
    audit(req.user, 'reservation.create', 'reservation', rid, {
      to: { reference, check_in: b.check_in, check_out: b.check_out, source, rooms: lines.map((l) => ({ room: l.room.room_no, rate: l.rate, rate_override: l.rate !== l.room.type_rate })) },
    });
    refreshReservationStatus(rid);
    return rid;
  });
  res.json(reservationDetail(id));
});

// ---------------------------------------------------------------------
// amend (FO-RSV-05..08): edits the existing reservation; availability revalidated;
// new allocation secured before old one is released (single transaction).
// ---------------------------------------------------------------------
reservationsRouter.put('/:id', requirePerm('reservation.edit'), (req, res) => {
  const r = load(req.params.id);
  if (r.reservation_status !== 'Active / Booked') throw conflict('Only active reservations can be amended.');
  const existing = db.prepare('SELECT * FROM reservation_room_lines WHERE reservation_id = ?').all(r.id);
  const checkedIn = existing.filter((l) => l.line_status === 'Checked In');
  const b = req.body;
  const check_in = b.check_in ?? r.check_in;
  const check_out = b.check_out ?? r.check_out;
  if (checkedIn.length && check_in !== r.check_in) throw conflict('Check-in date cannot change after a room is checked in.');
  validateDates(check_in, check_out, { allowPast: check_in === r.check_in });
  const incoming = (b.lines || []).map(parseLine);
  if (!incoming.length) throw bad('A reservation needs at least one room. Use Cancel Reservation instead.');
  if (new Set(incoming.map((l) => l.room.id)).size !== incoming.length) throw bad('The same room is listed twice.');
  const before = reservationDetail(r.id);
  tx(() => {
    db.prepare('UPDATE reservations SET check_in = ?, check_out = ?, source = ?, remarks = ?, updated_at = ? WHERE id = ?')
      .run(check_in, check_out, b.source ?? r.source, b.remarks ?? r.remarks, now(), r.id);
    if (b.guest) {
      db.prepare('UPDATE guests SET full_name = ?, contact_no = ?, email = ? WHERE id = ?')
        .run(str(b.guest.full_name, 'Guest name'), str(b.guest.contact_no, 'Contact number', { max: 40 }), b.guest.email || null, r.guest_id);
    }
    const keepIds = new Set();
    for (const l of incoming) {
      const old = l.id ? existing.find((e) => e.id === l.id && e.line_status !== 'Cancelled') : null;
      if (l.id && !old) throw bad('Room line not found on this reservation.');
      if (old?.line_status === 'Checked In' && old.room_id !== l.room.id) throw conflict('Use Change Room to move a checked-in room.');
      if (old) {
        keepIds.add(old.id);
        const roomChanged = old.room_id !== l.room.id;
        db.prepare(`UPDATE reservation_room_lines SET room_type_id = ?, room_id = ?, rate_per_night = ?, effective_rate = ?, adults = ?, children = ?, seniors = ?, pwd = ?,
                    hk_confirmed_at = CASE WHEN ? THEN NULL ELSE hk_confirmed_at END, hk_confirmed_by = CASE WHEN ? THEN NULL ELSE hk_confirmed_by END WHERE id = ?`)
          .run(l.room.room_type_id, l.room.id, l.rate, roomChanged || old.effective_rate === old.rate_per_night ? l.rate : old.effective_rate,
            l.adults, l.children, l.seniors, l.pwd, roomChanged ? 1 : 0, roomChanged ? 1 : 0, old.id);
      } else {
        const nid = Number(db.prepare(`INSERT INTO reservation_room_lines(reservation_id, room_type_id, room_id, rate_per_night, effective_rate, adults, children, seniors, pwd)
                                       VALUES(?,?,?,?,?,?,?,?,?)`).run(r.id, l.room.room_type_id, l.room.id, l.rate, l.rate, l.adults, l.children, l.seniors, l.pwd).lastInsertRowid);
        keepIds.add(nid);
      }
    }
    for (const e of existing) {
      if (e.line_status === 'Active' && !keepIds.has(e.id)) db.prepare("UPDATE reservation_room_lines SET line_status = 'Cancelled' WHERE id = ?").run(e.id);
      if (e.line_status === 'Checked In' && !keepIds.has(e.id)) throw conflict('A checked-in room cannot be removed.');
    }
    // Revalidate every active line against everyone else's bookings (own lines excluded).
    const ownIds = db.prepare('SELECT id FROM reservation_room_lines WHERE reservation_id = ?').all(r.id).map((x) => x.id);
    for (const l of db.prepare("SELECT * FROM reservation_room_lines WHERE reservation_id = ? AND line_status IN ('Active','Checked In')").all(r.id)) {
      assertRoomFree(roomById(l.room_id), check_in, check_out, ownIds);
    }
    const after = reservationDetail(r.id);
    const snap = (d) => ({ check_in: d.reservation.check_in, check_out: d.reservation.check_out, source: d.reservation.source, remarks: d.reservation.remarks, guest: d.guest.full_name,
      rooms: d.lines.filter((l) => l.line_status !== 'Cancelled').map((l) => ({ room: l.room_no, rate: l.rate_per_night, adults: l.adults, children: l.children, seniors: l.seniors, pwd: l.pwd })), total: d.totals.total });
    audit(req.user, 'reservation.amend', 'reservation', r.id, { from: snap(before), to: snap(after), reason: b.reason || null });
    refreshReservationStatus(r.id);
  });
  res.json(reservationDetail(r.id));
});

// ---------------------------------------------------------------------
// cancel (FO-RSV-09/10): dedicated action, never a delete; refund is separate (FO-RSV-11)
// ---------------------------------------------------------------------
reservationsRouter.post('/:id/cancel', requirePerm('reservation.edit'), (req, res) => {
  const r = load(req.params.id);
  if (r.reservation_status !== 'Active / Booked') throw conflict('Only active reservations can be cancelled.');
  if (db.prepare("SELECT 1 FROM reservation_room_lines WHERE reservation_id = ? AND line_status IN ('Checked In','Checked Out')").get(r.id))
    throw conflict('A room on this reservation is already checked in. It cannot be cancelled.');
  const reason = str(req.body.reason, 'Cancellation reason');
  tx(() => {
    db.prepare("UPDATE reservation_room_lines SET line_status = 'Cancelled' WHERE reservation_id = ? AND line_status = 'Active'").run(r.id);
    db.prepare("UPDATE reservations SET reservation_status = 'Cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ?")
      .run(reason, req.user.username, now(), r.id);
    refreshReservationStatus(r.id);
    audit(req.user, 'reservation.cancel', 'reservation', r.id, { from: 'Active / Booked', to: 'Cancelled', reason });
  });
  res.json(reservationDetail(r.id));
});

/** Refund / forfeit decision: separate approved transaction (OD-03 rules still TO CONFIRM). */
reservationsRouter.post('/:id/refund-decision', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  if (r.reservation_status !== 'Cancelled') throw conflict('Refund decisions apply to cancelled reservations.');
  if (r.refund_decision) throw conflict('A refund decision was already recorded.');
  const decision = oneOf(req.body.decision, ['No Refund', 'Refund Completed'], 'Decision');
  const reason = str(req.body.reason, 'Reason');
  const approver = verifyApproval(req, req.body.approval, 'A refund decision');
  const t = reservationTotals(r.id);
  tx(() => {
    if (decision === 'Refund Completed') {
      const amount = money(req.body.amount, 'Refund amount', { allowZero: false });
      if (amount > t.paid) throw bad('Refund cannot exceed the amount received.');
      const method = req.body.method;
      if (!getSetting('payment_methods', []).includes(method)) throw bad('Choose the refund method.');
      recordPayment(req.user, {
        kind: 'refund', accountType: 'reservation', accountId: r.id, purpose: 'Refund', note: reason, issueReceipt: false,
        tenders: [{ method, amount: -amount, reference: req.body.reference || null }],
        allocations: [{ target_type: 'reservation', target_id: r.id, amount: -amount }],
      });
    }
    db.prepare('UPDATE reservations SET refund_decision = ?, refund_note = ?, refund_approver = ? WHERE id = ?').run(decision, reason, approver, r.id);
    refreshReservationStatus(r.id);
    audit(req.user, 'reservation.refund_decision', 'reservation', r.id, { to: decision, reason, approver });
  });
  res.json(reservationDetail(r.id));
});

// ---------------------------------------------------------------------
// Opening records at cutover (Fixed decision 7): in-house guests from WinCloud
// ---------------------------------------------------------------------
reservationsRouter.post('/opening', requirePerm('approve'), (req, res) => {
  const b = req.body;
  validateDates(b.check_in, b.check_out, { allowPast: true });
  if (b.check_out <= today()) throw bad('Only stays that are still in-house or in the future are entered at cutover.');
  const lines = (b.lines || []).map(parseLine);
  if (!lines.length) throw bad('Add at least one room.');
  const inHouse = !!b.in_house;
  const opening_paid = money(b.opening_paid ?? 0, 'Amount already received in WinCloud');
  const opening_charges = money(b.opening_charges ?? 0, 'Unpaid extra charges already on the WinCloud folio');
  const winRef = str(b.wincloud_ref, 'WinCloud reference');
  const id = tx(() => {
    const guestId = Number(db.prepare('INSERT INTO guests(full_name, contact_no, email, created_at) VALUES(?,?,?,?)')
      .run(str(b.guest?.full_name, 'Guest name'), str(b.guest?.contact_no, 'Contact number', { max: 40 }), null, now()).lastInsertRowid);
    const reference = nextNo('reservation', 'RSV-', 6);
    const rid = Number(db.prepare(`INSERT INTO reservations(reference, guest_id, source, check_in, check_out, reservation_status, payment_status,
        down_payment_pct, remarks, is_opening_record, created_by, created_at, id_type, id_verified_by, id_verified_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`)
      .run(reference, guestId, b.source || 'Cutover from WinCloud', b.check_in, b.check_out, 'Active / Booked', 'Unpaid', Number(getSetting('down_payment_pct', 30)),
        `Opening record. WinCloud ref ${winRef}. ${b.remarks || ''}`.trim(), req.user.username, now(),
        inHouse ? 'Verified in WinCloud' : null, inHouse ? req.user.username : null, inHouse ? now() : null).lastInsertRowid);
    for (const l of lines) {
      assertRoomFree(l.room, maxDate(b.check_in, today()), b.check_out);
      const lid = Number(db.prepare(`INSERT INTO reservation_room_lines(reservation_id, room_type_id, room_id, rate_per_night, effective_rate, adults, children, seniors, pwd, line_status, signed_form_at, signed_form_by, hk_confirmed_at, hk_confirmed_by)
                                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(rid, l.room.room_type_id, l.room.id, l.rate, l.rate, l.adults, l.children, l.seniors, l.pwd, inHouse ? 'Checked In' : 'Active',
          inHouse ? now() : null, inHouse ? 'cutover' : null, inHouse ? now() : null, inHouse ? 'cutover' : null).lastInsertRowid);
      if (inHouse) db.prepare("INSERT INTO guest_stays(line_id, room_id, occupancy_status, checked_in_at, checked_in_by, checkin_exception) VALUES(?,?,'Checked In',?,?,?)")
        .run(lid, l.room.id, now(), req.user.username, 'Cutover opening record');
    }
    if (opening_charges > 0) db.prepare("INSERT INTO folio_charges(reservation_id, kind, description, amount, reason, created_by, created_at) VALUES(?, 'opening', ?, ?, ?, ?, ?)")
      .run(rid, `Opening balance from WinCloud (${winRef})`, opening_charges, 'Cutover', req.user.username, now());
    if (opening_paid > 0) recordPayment(req.user, {
      kind: 'opening', accountType: 'reservation', accountId: rid, purpose: 'Opening balance', note: `Received before cutover, WinCloud ${winRef}`, issueReceipt: false,
      tenders: [{ method: 'Opening balance (WinCloud)', amount: opening_paid, reference: winRef }],
      allocations: [{ target_type: 'reservation', target_id: rid, amount: opening_paid }],
    });
    audit(req.user, 'reservation.opening_record', 'reservation', rid, { to: { reference, winRef, inHouse, opening_paid, opening_charges } });
    refreshReservationStatus(rid);
    return rid;
  });
  res.json(reservationDetail(id));
});

// ---------------------------------------------------------------------
// Check-in steps (Part 2, Fig. 1)
// ---------------------------------------------------------------------
reservationsRouter.post('/:id/lines/:lineId/hk-confirm', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const l = loadLine(r, req.params.lineId);
  if (l.line_status !== 'Active') throw conflict('This room is not waiting for check-in.');
  if (req.body.confirmed === false) {
    db.prepare('UPDATE reservation_room_lines SET hk_confirmed_at = NULL, hk_confirmed_by = NULL WHERE id = ?').run(l.id);
  } else {
    const room = roomById(l.room_id);
    const rd = roomReady(room, l.id);
    if (!rd.ready) throw conflict(`Room ${room.room_no} is not ready: ${rd.why}. Waiting for Room.`);
    db.prepare('UPDATE reservation_room_lines SET hk_confirmed_at = ?, hk_confirmed_by = ? WHERE id = ?').run(now(), req.user.username, l.id);
  }
  audit(req.user, 'checkin.hk_confirm', 'reservation', r.id, { to: { line: l.id, confirmed: req.body.confirmed !== false }, reason: req.body.note || 'Readiness confirmed with Housekeeping' });
  res.json(reservationDetail(r.id));
});

reservationsRouter.post('/:id/id-verify', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const id_type = str(req.body.id_type, 'ID type');
  const id_ref = req.body.id_ref ? String(req.body.id_ref).trim().slice(0, 60) : null; // OD-11: storage of ID number to confirm
  if (!req.body.verified) throw bad('Tick "ID verified against the guest" to continue.');
  tx(() => {
    let attId = r.id_attachment_id;
    if (req.body.file) attId = saveAttachment(req.user, { entity: 'reservation', entity_id: r.id, kind: 'id_copy', file: req.body.file, restricted: 1 });
    db.prepare('UPDATE reservations SET id_type = ?, id_ref = ?, id_verified_by = ?, id_verified_at = ?, id_attachment_id = ? WHERE id = ?')
      .run(id_type, id_ref, req.user.username, now(), attId, r.id);
    audit(req.user, 'checkin.id_verified', 'reservation', r.id, { to: { id_type, id_ref_stored: !!id_ref, id_copy: !!attId } });
  });
  res.json(reservationDetail(r.id));
});

reservationsRouter.post('/:id/signed-form', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const lineIds = (req.body.line_ids || []).map(Number);
  if (!lineIds.length) throw bad('Choose the room(s) this signed form covers.');
  tx(() => {
    let attId = null;
    if (req.body.file) attId = saveAttachment(req.user, { entity: 'reservation', entity_id: r.id, kind: 'registration_form', file: req.body.file, restricted: 1 });
    else if (!req.body.paper_on_file) throw bad('Attach the signed copy, or tick that the signed paper form is on file.');
    for (const lid of lineIds) {
      const l = loadLine(r, lid);
      db.prepare('UPDATE reservation_room_lines SET signed_form_at = ?, signed_form_by = ?, signed_form_attachment_id = ? WHERE id = ?').run(now(), req.user.username, attId, l.id);
    }
    audit(req.user, 'checkin.signed_form', 'reservation', r.id, { to: { lines: lineIds, attachment: attId, paper_on_file: !!req.body.paper_on_file } });
  });
  res.json(reservationDetail(r.id));
});

/** Confirm Check-in gate per selected room: ID verified, signed form, balance or approved exception, room ready. */
reservationsRouter.post('/:id/checkin', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  if (!['Active / Booked', 'Checked In'].includes(r.reservation_status)) throw conflict(`Reservation is ${r.reservation_status}.`);
  const t0 = today();
  if (t0 < r.check_in) throw conflict(`Check-in date is ${r.check_in}. Amend the reservation for an early arrival.`);
  if (t0 >= r.check_out) throw conflict('The stay dates have passed. Amend the reservation first.');
  const lineIds = (req.body.line_ids || []).map(Number);
  if (!lineIds.length) throw bad('Select the room(s) to check in.');
  const lines = lineIds.map((id) => loadLine(r, id));
  const totals = reservationTotals(r.id);
  const failures = [];
  const needForm = getSetting('checkin_require_signed_form', true);
  if (!r.id_verified_at) failures.push('Primary guest ID is not verified.');
  for (const l of lines) {
    const room = roomById(l.room_id);
    if (l.line_status !== 'Active') failures.push(`${room?.room_no}: already ${l.line_status}.`);
    if (needForm && !l.signed_form_at) failures.push(`${room.room_no}: signed registration form not attached.`);
    const rd = roomReady(room, l.id);
    if (!rd.ready) failures.push(`${room.room_no}: not ready (${rd.why}).`);
    else if (!l.hk_confirmed_at && getSetting('fo_confirms_housekeeping', true)) failures.push(`${room.room_no}: readiness not yet confirmed with Housekeeping.`);
  }
  let exception = null;
  if (totals.outstanding > 0) {
    if (req.body.exception?.reason) {
      const approver = verifyApproval(req, req.body.exception.approval, 'Checking in with a balance');
      exception = `Balance ${totals.outstanding} allowed by ${approver}: ${req.body.exception.reason}`;
    } else failures.push('Outstanding balance must be collected, or a supervisor must approve an exception.');
  }
  if (failures.length) throw new HttpError(422, 'Check-in cannot be confirmed yet.', { failures });
  tx(() => {
    for (const l of lines) {
      db.prepare("UPDATE reservation_room_lines SET line_status = 'Checked In' WHERE id = ?").run(l.id);
      db.prepare("INSERT INTO guest_stays(line_id, room_id, occupancy_status, checked_in_at, checked_in_by, checkin_exception) VALUES(?,?,'Checked In',?,?,?)")
        .run(l.id, l.room_id, now(), req.user.username, exception);
      audit(req.user, 'checkin.confirm', 'reservation', r.id, { from: 'Active', to: { line: l.id, room: roomById(l.room_id).room_no, status: 'Checked In', availability: 'Occupied' }, reason: exception });
    }
    refreshReservationStatus(r.id);
  });
  res.json(reservationDetail(r.id));
});

// ---------------------------------------------------------------------
// Room transfer
// ---------------------------------------------------------------------
function transferWindow(r, l) {
  const start = l.line_status === 'Checked In' ? maxDate(today(), r.check_in) : r.check_in;
  return { start, end: r.check_out, nights: Math.max(nightsBetween(start, r.check_out), 1) };
}

reservationsRouter.get('/:id/lines/:lineId/transfer-options', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const l = loadLine(r, req.params.lineId);
  const w = transferWindow(r, l);
  const current = roomById(l.room_id);
  const rooms = db.prepare(`SELECT r.*, t.name AS category, t.rate_per_night AS type_rate FROM rooms r JOIN room_types t ON t.id = r.room_type_id
                            WHERE r.active = 1 AND r.id != ? ORDER BY t.rate_per_night, r.room_no`).all(l.room_id)
    .map((room) => {
      let free = true; let why = null;
      try { assertRoomFree(room, w.start, w.end, [l.id]); } catch (e) { free = false; why = e.message; }
      const rd = roomReady(room, l.id);
      const needReady = w.start <= today();
      return { id: room.id, room_no: room.room_no, category: room.category, rate_per_night: room.type_rate, hk_status: room.hk_status, block_status: room.block_status,
        selectable: free && (!needReady || rd.ready), why: !free ? why : needReady && !rd.ready ? rd.why : null };
    });
  res.json({
    line: { ...l, room_no: current.room_no, category: current.category }, window: w, current_rate: l.effective_rate, rooms,
    stage: l.line_status === 'Checked In' ? 'during stay' : 'check-in in progress',
    reasons: { fault: getSetting('transfer_reasons_fault', []), guest: getSetting('transfer_reasons_guest', []) },
  });
});

reservationsRouter.post('/:id/lines/:lineId/transfer', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const l = loadLine(r, req.params.lineId);
  if (!['Active', 'Checked In'].includes(l.line_status)) throw conflict('This room line cannot be transferred.');
  const b = req.body;
  const reason_type = oneOf(b.reason_type, ['fault', 'guest'], 'Reason type');
  const reason = str(b.reason, 'Reason');
  const from = roomById(l.room_id);
  const to = roomById(int(b.to_room_id, 'New room', { min: 1 }));
  if (!to || to.id === from.id) throw bad('Choose a different room.');
  const w = transferWindow(r, l);
  const result = tx(() => {
    assertRoomFree(to, w.start, w.end, [l.id]);
    if (w.start <= today()) {
      const rd = roomReady(to, l.id);
      if (!rd.ready) throw conflict(`Room ${to.room_no} is not ready: ${rd.why}.`);
    }
    const current_rate = l.effective_rate;
    const new_rate = to.type_rate;
    const diff = new_rate - current_rate;
    const upgrade_value = Math.max(diff, 0) * w.nights; // RT-01: amount rule TO CONFIRM; per-night difference x remaining nights
    let treatment = 'No charge (same rate)';
    let waived_by = null;
    let approvalId = null;
    let payment = null;
    let newEffective = current_rate;
    if (diff < 0) treatment = 'Lower-rate room: rate kept (RT-03 open)';
    if (diff > 0 && reason_type === 'fault') {
      // Part 2 Fig. 2 / RT-F: a waiver needs an approved request from the Front Office Supervisor.
      if (b.approval_id) {
        const ap = consumeApproval(Number(b.approval_id), { type: 'transfer_waiver', entity: 'reservation', entity_id: r.id, match: { line_id: l.id, to_room_id: to.id } });
        waived_by = ap.decided_by;
        approvalId = ap.id;
      } else if (can(req.user, 'approve')) {
        waived_by = req.user.username;
      } else throw new HttpError(403, 'Waiving the upgrade difference needs Front Office Supervisor approval. Request approval first.', { needsApproval: true });
      treatment = 'Free upgrade (fault on resort side)';
    }
    if (diff > 0 && reason_type === 'guest') {
      treatment = 'Paid upgrade (guest request)';
      const tenders = validateTenders(b.tenders);
      const paid = tenders.reduce((s, t) => s + t.amount, 0);
      if (paid !== upgrade_value) throw bad(`Guest must pay exactly the upgrade value before the transfer is confirmed.`);
      db.prepare("INSERT INTO folio_charges(reservation_id, line_id, kind, description, amount, reason, created_by, created_at) VALUES(?,?,'upgrade',?,?,?,?,?)")
        .run(r.id, l.id, `Upgrade ${from.room_no} > ${to.room_no}: ${w.nights} night(s) x ${(diff / 100).toFixed(2)}`, upgrade_value, reason, req.user.username, now());
      payment = recordPayment(req.user, { accountType: 'reservation', accountId: r.id, purpose: 'Room upgrade', tenders, allocations: [{ target_type: 'reservation', target_id: r.id, amount: upgrade_value }] });
      newEffective = new_rate;
    }
    // Original room next status (RT-H)
    let original_room_next;
    if (reason_type === 'fault') {
      setBlock(req.user, from.id, 'Under Repair / Blocked', `Transfer: ${reason}`);
      if (b.report_defect !== false) db.prepare('INSERT INTO room_defects(room_id, note, source, reported_by, reported_at) VALUES(?,?,?,?,?)')
        .run(from.id, `${reason}${b.remarks ? ' - ' + b.remarks : ''}`, `Room transfer ${r.reference}`, req.user.username, now());
      if (l.line_status === 'Checked In') setHkStatus(req.user, from.id, 'Dirty', 'Guest moved out (transfer)');
      original_room_next = 'Blocked / Under Repair';
    } else if (l.line_status === 'Checked In') {
      setHkStatus(req.user, from.id, 'Dirty', 'Guest moved out (transfer)');
      original_room_next = 'Dirty';
    } else original_room_next = 'Unchanged';

    const ready = roomReady(to, l.id).ready;
    db.prepare('UPDATE reservation_room_lines SET room_id = ?, room_type_id = ?, effective_rate = ?, hk_confirmed_at = ?, hk_confirmed_by = ? WHERE id = ?')
      .run(to.id, to.room_type_id, newEffective, ready ? now() : null, ready ? req.user.username : null, l.id);
    db.prepare("UPDATE guest_stays SET room_id = ? WHERE line_id = ? AND occupancy_status = 'Checked In'").run(to.id, l.id);
    const trId = Number(db.prepare(`INSERT INTO room_transfers(reservation_id, line_id, from_room_id, to_room_id, stage, reason_type, reason, remarks, current_rate, new_rate, nights,
        upgrade_value, treatment, waived_by, payment_id, original_room_next, created_by, created_at, approval_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(r.id, l.id, from.id, to.id, l.line_status === 'Checked In' ? 'during stay' : 'check-in', reason_type, reason, b.remarks || null, current_rate, new_rate, w.nights,
        upgrade_value, treatment, waived_by, payment?.id ?? null, original_room_next, req.user.username, now(), approvalId).lastInsertRowid);
    audit(req.user, 'room.transfer', 'reservation', r.id, { from: from.room_no, to: { room: to.room_no, treatment, upgrade_value, original_room_next }, reason: `${reason_type}: ${reason}`, approver: waived_by });
    refreshReservationStatus(r.id);
    return { transfer_id: trId, payment };
  });
  res.json({ ...reservationDetail(r.id), transfer: result });
});

// ---------------------------------------------------------------------
// Folio: extra charges, voids (reversing rows), discounts, payments
// ---------------------------------------------------------------------
reservationsRouter.post('/:id/charges', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  if (!['Active / Booked', 'Checked In'].includes(r.reservation_status)) throw conflict('Folio is closed.');
  const kind = oneOf(req.body.kind || 'extra', ['extra', 'inspection', 'damage', 'adjustment'], 'Charge type');
  const description = str(req.body.description, 'Description');
  const amount = money(req.body.amount, 'Amount', { allowZero: false });
  const reason = str(req.body.reason, 'Source / reason / evidence');
  const lineId = req.body.line_id ? loadLine(r, req.body.line_id).id : null;
  // Part 1 s5.2 step 3: an inspection / extra charge needs source, reason and evidence (photo or document).
  const id = tx(() => {
    const att = req.body.file ? saveAttachment(req.user, { entity: 'reservation', entity_id: r.id, kind: 'charge_evidence', file: req.body.file }) : null;
    const cid = db.prepare('INSERT INTO folio_charges(reservation_id, line_id, kind, description, amount, reason, attachment_id, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(r.id, lineId, kind, description, amount, reason, att, req.user.username, now()).lastInsertRowid;
    audit(req.user, 'folio.charge', 'reservation', r.id, { to: { id: Number(cid), kind, description, amount, evidence: att }, reason });
    return cid;
  });
  void id;
  refreshReservationStatus(r.id);
  res.json(reservationDetail(r.id));
});

reservationsRouter.post('/:id/charges/:chargeId/void', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const c = db.prepare('SELECT * FROM folio_charges WHERE id = ? AND reservation_id = ?').get(req.params.chargeId, r.id);
  if (!c) throw notFound('Charge');
  if (c.reverses_id || c.amount < 0) throw conflict('A reversal cannot be voided.');
  if (db.prepare('SELECT 1 FROM folio_charges WHERE reverses_id = ?').get(c.id)) throw conflict('Already voided.');
  if (c.kind === 'upgrade') throw conflict('Upgrade charges are tied to a paid transfer and cannot be voided here.');
  const reason = str(req.body.reason, 'Reason');
  const approver = verifyApproval(req, req.body.approval, 'Voiding a charge');
  tx(() => {
    db.prepare('INSERT INTO folio_charges(reservation_id, line_id, kind, description, amount, reason, reverses_id, approver, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(r.id, c.line_id, 'reversal', `VOID: ${c.description}`, -c.amount, reason, c.id, approver, req.user.username, now());
    audit(req.user, 'folio.void', 'reservation', r.id, { from: { charge: c.id, amount: c.amount }, to: 'reversed', reason, approver });
    refreshReservationStatus(r.id);
  });
  res.json(reservationDetail(r.id));
});

/** Discount lines: original sale, discount and net stay separate. Senior/PWD formula is TO CONFIRM (OD-09/10/12). */
reservationsRouter.post('/:id/discounts', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  if (!['Active / Booked', 'Checked In'].includes(r.reservation_status)) throw conflict('Folio is closed.');
  const category = str(req.body.category, 'Discount category');
  const amount = money(req.body.amount, 'Discount amount', { allowZero: false });
  const reason = str(req.body.reason, 'Reason / ID reference');
  if (/senior|pwd/i.test(category) && !req.body.id_verified) throw bad('A Senior Citizen / PWD discount needs the ID verified first.');
  const approver = verifyApproval(req, req.body.approval, 'A discount');
  const t = reservationTotals(r.id);
  if (amount > t.outstanding) throw bad('Discount is larger than the outstanding balance.');
  db.prepare("INSERT INTO discount_lines(target_type, target_id, txn_ref, category, basis, vat_treatment, amount, reason, approver, id_verified, created_by, created_at) VALUES('reservation',?,?,?,?,?,?,?,?,?,?,?)")
    .run(r.id, req.body.txn_ref || null, category, req.body.basis || null, req.body.vat_treatment || null, amount, reason, approver, req.body.id_verified ? 1 : 0, req.user.username, now());
  audit(req.user, 'folio.discount', 'reservation', r.id, { to: { category, amount }, reason, approver });
  refreshReservationStatus(r.id);
  res.json(reservationDetail(r.id));
});

reservationsRouter.post('/:id/payments', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  if (r.reservation_status === 'Cancelled') throw conflict('Reservation is cancelled.');
  const tenders = validateTenders(req.body.tenders);
  const amount = tenders.reduce((s, t) => s + t.amount, 0);
  const t = reservationTotals(r.id);
  if (amount > t.outstanding) throw bad(`Over-collection blocked. Outstanding balance is ${(t.outstanding / 100).toFixed(2)}.`);
  const purpose = r.reservation_status === 'Active / Booked' && !db.prepare("SELECT 1 FROM reservation_room_lines WHERE reservation_id = ? AND line_status = 'Checked In'").get(r.id)
    ? (t.paid === 0 && r.check_in > today() ? 'Down payment' : t.paid < t.downPaymentRequired && r.check_in > today() ? 'Partial payment' : 'Balance at check-in')
    : r.reservation_status === 'Checked Out' ? 'Final settlement' : 'Settlement';
  const p = tx(() => {
    const out = recordPayment(req.user, { accountType: 'reservation', accountId: r.id, purpose, tenders, allocations: [{ target_type: 'reservation', target_id: r.id, amount }], note: req.body.note });
    refreshReservationStatus(r.id);
    return out;
  });
  res.json({ ...reservationDetail(r.id), payment: p });
});

// ---------------------------------------------------------------------
// Check-out (Part 1, s5.2)
// ---------------------------------------------------------------------
reservationsRouter.post('/:id/checkout', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const lineIds = (req.body.line_ids || []).map(Number);
  if (!lineIds.length) throw bad('Select the room(s) to check out.');
  const lines = lineIds.map((id) => loadLine(r, id));
  if (lines.some((l) => l.line_status !== 'Checked In')) throw conflict('Only checked-in rooms can be checked out.');
  const t = reservationTotals(r.id);
  let exception = null;
  if (t.outstanding > 0) {
    if (!req.body.exception?.reason) throw new HttpError(422, 'Collect the final balance before check-out, or get an approved exception.', { failures: [`Outstanding ${(t.outstanding / 100).toFixed(2)}`] });
    const approver = verifyApproval(req, req.body.exception.approval, 'Checking out with a balance');
    exception = `Balance ${t.outstanding} allowed by ${approver}: ${req.body.exception.reason}`;
  }
  tx(() => {
    for (const l of lines) {
      db.prepare("UPDATE reservation_room_lines SET line_status = 'Checked Out' WHERE id = ?").run(l.id);
      db.prepare("UPDATE guest_stays SET occupancy_status = 'Checked Out', checked_out_at = ?, checked_out_by = ?, inspection_note = ?, checkout_exception = ? WHERE line_id = ?")
        .run(now(), req.user.username, req.body.inspection_note || null, exception, l.id);
      setHkStatus(req.user, l.room_id, 'Dirty', `Check-out ${r.reference}`);
      audit(req.user, 'checkout.confirm', 'reservation', r.id, { to: { line: l.id, room: roomById(l.room_id).room_no, occupancy: 'Checked Out', housekeeping: 'Dirty' }, reason: exception });
    }
    refreshReservationStatus(r.id);
  });
  res.json(reservationDetail(r.id));
});

// ---------------------------------------------------------------------
// Attachments (restricted access to ID copies & signed forms - OD-11/OD-20)
// ---------------------------------------------------------------------
export const attachmentsRouter = express.Router();
attachmentsRouter.use(authenticate);
attachmentsRouter.get('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) throw notFound('Attachment');
  if (a.restricted && !can(req.user, 'frontdesk')) throw new HttpError(403, 'Restricted document.');
  audit(req.user, 'attachment.view', a.entity, a.entity_id, { to: { attachment: a.id, kind: a.kind } });
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `inline; filename="${a.filename.replace(/"/g, '')}"`);
  res.send(fs.readFileSync(path.join(UPLOAD_DIR, a.path)));
});

void occupyingStay;

/** Log a follow-up with a guest whose down payment is still outstanding (call, message, promise to pay). */
reservationsRouter.post('/:id/follow-up', requirePerm('reservation.edit'), (req, res) => {
  const r = load(req.params.id);
  if (r.reservation_status !== 'Active / Booked') throw conflict('Follow-ups are for active reservations.');
  const note = str(req.body.note, 'Follow-up note');
  audit(req.user, 'reservation.follow_up', 'reservation', r.id, { to: { channel: req.body.channel || null, promised_date: req.body.promised_date || null }, reason: note });
  res.json(reservationDetail(r.id));
});

/** Guest has arrived but the room is not ready: Occupancy stays Not Arrived, stay becomes Check-in Pending (Part 1 s5.1). */
reservationsRouter.post('/:id/lines/:lineId/arrived', requirePerm('frontdesk'), (req, res) => {
  const r = load(req.params.id);
  const l = loadLine(r, req.params.lineId);
  if (l.line_status !== 'Active') throw conflict('This room is not waiting for check-in.');
  if (req.body.undo) db.prepare('UPDATE reservation_room_lines SET arrived_at = NULL, arrived_by = NULL, arrival_note = NULL WHERE id = ?').run(l.id);
  else db.prepare('UPDATE reservation_room_lines SET arrived_at = ?, arrived_by = ?, arrival_note = ? WHERE id = ?')
    .run(now(), req.user.username, req.body.note || 'Waiting in the restaurant waiting area', l.id);
  audit(req.user, req.body.undo ? 'checkin.pending_undo' : 'checkin.pending', 'reservation', r.id, { to: { line: l.id, stay: req.body.undo ? null : 'Check-in Pending' }, reason: req.body.note });
  res.json(reservationDetail(r.id));
});
