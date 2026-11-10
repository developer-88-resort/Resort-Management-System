// Room inventory, availability (one shared live inventory for Marketing + Front Office),
// Phase 1 room board (housekeeping status), defects and room blocks.
import express from 'express';
import { db } from '../db.js';
import { authenticate, requirePerm, can, bad, notFound, str, isDate, today, addDays, now, audit, tx, getSetting, nightsBetween } from '../lib.js';
import { roomAvailabilityToday, roomBookings, occupyingStay, setHkStatus, setBlock } from '../domain.js';

export const roomsRouter = express.Router();
roomsRouter.use(authenticate);

const HK = ['Dirty', 'Cleaning In Progress', 'For Inspection', 'Clean'];

function roomRow(r) {
  const occ = occupyingStay(r.id);
  let occupant = null;
  if (occ) {
    const g = db.prepare(`SELECT g.full_name, res.reference, res.id AS reservation_id, res.check_out FROM reservations res JOIN guests g ON g.id = res.guest_id WHERE res.id = ?`).get(occ.reservation_id);
    occupant = g;
  }
  const t = today();
  const next = db.prepare(`SELECT res.reference, res.check_in, res.id AS reservation_id, g.full_name FROM reservation_room_lines l
      JOIN reservations res ON res.id = l.reservation_id JOIN guests g ON g.id = res.guest_id
      WHERE l.room_id = ? AND l.line_status = 'Active' AND res.check_out > ? ORDER BY res.check_in LIMIT 1`).get(r.id, t);
  return {
    ...r,
    availability: roomAvailabilityToday(r),
    occupant,
    next_arrival: next || null,
    open_defects: db.prepare("SELECT id, note, reported_by, reported_at FROM room_defects WHERE room_id = ? AND status = 'Open'").all(r.id),
  };
}

roomsRouter.get('/', requirePerm('rooms.view'), (_req, res) => {
  const rooms = db.prepare(`SELECT r.*, t.name AS category, t.rate_per_night FROM rooms r JOIN room_types t ON t.id = r.room_type_id
                            WHERE r.active = 1 ORDER BY r.room_no`).all();
  // Part 1 flow 6: check-in, check-out and transfer events from Front Office reach Housekeeping.
  const events = db.prepare(`SELECT at, username, action, entity, entity_id, to_value, reason FROM audit_events
      WHERE action IN ('checkin.confirm','checkout.confirm','room.transfer','room.block','room.defect') AND at >= ? ORDER BY id DESC LIMIT 60`)
    .all(new Date(Date.now() - 24 * 3600e3).toISOString())
    .map((e) => {
      let to = null; try { to = JSON.parse(e.to_value); } catch { to = e.to_value; }
      const label = { 'checkin.confirm': 'Check-in', 'checkout.confirm': 'Check-out', 'room.transfer': 'Room transfer', 'room.block': 'Room block', 'room.defect': 'Defect reported' }[e.action];
      const room = e.entity === 'room' ? e.entity_id : to?.room || null;
      return { at: e.at, by: e.username, label, room, detail: e.action === 'checkout.confirm' ? 'Room set to Dirty' : e.action === 'room.transfer' ? `${to?.treatment || ''}; old room ${to?.original_room_next || ''}` : e.reason || '' };
    });
  res.json({ rooms: rooms.map(roomRow), hk_statuses: HK, inspection_rule: getSetting('hk_inspection_rule'), events });
});

roomsRouter.get('/:id/history', requirePerm('rooms.view'), (req, res) => {
  res.json({ log: db.prepare('SELECT * FROM housekeeping_log WHERE room_id = ? ORDER BY id DESC LIMIT 100').all(req.params.id) });
});

/** Availability search for a date range (one live inventory, FO-RSV-03). */
roomsRouter.get('/availability', requirePerm('reservation.view', 'frontdesk'), (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to) || to <= from) throw bad('Choose a valid check-in and check-out date.');
  const exclude = String(req.query.exclude_reservation || '');
  const excludeLines = exclude
    ? db.prepare('SELECT id FROM reservation_room_lines WHERE reservation_id = ?').all(exclude).map((x) => x.id) : [];
  const rooms = db.prepare(`SELECT r.*, t.name AS category, t.rate_per_night, t.max_occupancy FROM rooms r JOIN room_types t ON t.id = r.room_type_id
                            WHERE r.active = 1 AND t.active = 1 ORDER BY t.rate_per_night, r.room_no`).all();
  const out = rooms.map((r) => {
    const clash = roomBookings(r.id, from, to, excludeLines);
    const occ = occupyingStay(r.id);
    const occupiedNow = occ && !excludeLines.includes(occ.line_id) && from <= today();
    const blocked = r.block_status !== 'None';
    return {
      id: r.id, room_no: r.room_no, category: r.category, room_type_id: r.room_type_id, rate_per_night: r.rate_per_night,
      max_occupancy: r.max_occupancy, hk_status: r.hk_status, block_status: r.block_status,
      available: !clash.length && !occupiedNow && !blocked,
      reason: clash.length ? `Booked (${clash.map((c) => c.reference).join(', ')})` : occupiedNow ? 'Occupied' : blocked ? r.block_status : null,
    };
  });
  res.json({ rooms: out, nights: nightsBetween(from, to) });
});

/** Calendar grid: who holds each room each night. */
roomsRouter.get('/calendar', requirePerm('reservation.view', 'frontdesk'), (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : today();
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
  const to = addDays(from, days);
  const rooms = db.prepare(`SELECT r.id, r.room_no, r.block_status, r.hk_status, t.name AS category FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE r.active = 1 ORDER BY r.room_no`).all();
  const lines = db.prepare(`SELECT l.room_id, l.line_status, res.id AS reservation_id, res.reference, res.check_in, res.check_out, g.full_name
      FROM reservation_room_lines l JOIN reservations res ON res.id = l.reservation_id JOIN guests g ON g.id = res.guest_id
      WHERE l.line_status IN ('Active','Checked In') AND res.check_in < ? AND res.check_out > ?`).all(to, from);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  res.json({ dates, rooms, bookings: lines });
});

// ---------- housekeeping status (Phase 1 room board) ----------
roomsRouter.post('/:id/hk-status', requirePerm('housekeeping'), (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) throw notFound('Room');
  const to = req.body.to;
  if (!HK.includes(to)) throw bad('Invalid housekeeping status.');
  const rule = getSetting('hk_inspection_rule', 'defect_only');
  const inspectionNeeded = rule === 'all' || room.needs_inspection;
  if (to === 'Clean' && inspectionNeeded) {
    if (room.hk_status !== 'For Inspection') throw bad('This room must pass For Inspection before it can be marked Clean (OD-04 rule).');
    if (!can(req.user, 'hk.supervise')) throw bad('Only the Housekeeping Supervisor can pass an inspection.');
  }
  if (to === 'Clean' && occupyingStay(room.id)) {
    // allowed (in-stay cleaning) but does not change availability
  }
  tx(() => {
    setHkStatus(req.user, room.id, to, req.body.note);
    if (to === 'Clean') db.prepare('UPDATE rooms SET needs_inspection = 0 WHERE id = ?').run(room.id);
  });
  res.json({ ok: true });
});

// ---------- defects & blocks ----------
roomsRouter.get('/defects/list', requirePerm('rooms.view'), (req, res) => {
  const status = req.query.status || 'Open';
  res.json({ defects: db.prepare(`SELECT d.*, r.room_no FROM room_defects d JOIN rooms r ON r.id = d.room_id
                                   WHERE (? = 'All' OR d.status = ?) ORDER BY d.id DESC LIMIT 300`).all(status, status) });
});

roomsRouter.post('/:id/defects', requirePerm('housekeeping', 'frontdesk'), (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) throw notFound('Room');
  const note = str(req.body.note, 'Defect description');
  tx(() => {
    db.prepare('INSERT INTO room_defects(room_id, note, source, reported_by, reported_at) VALUES(?,?,?,?,?)')
      .run(room.id, note, req.body.source || 'Room board', req.user.username, now());
    if (req.body.block) setBlock(req.user, room.id, 'Under Repair / Blocked', note);
    audit(req.user, 'room.defect', 'room', room.room_no, { to: note });
  });
  res.json({ ok: true });
});

roomsRouter.post('/defects/:id/resolve', requirePerm('housekeeping', 'hk.supervise'), (req, res) => {
  const d = db.prepare('SELECT * FROM room_defects WHERE id = ?').get(req.params.id);
  if (!d || d.status !== 'Open') throw notFound('Open defect');
  db.prepare("UPDATE room_defects SET status = 'Resolved', resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ?")
    .run(req.user.username, now(), req.body.resolution || null, d.id);
  audit(req.user, 'room.defect_resolved', 'room_defect', d.id, { reason: req.body.resolution });
  res.json({ ok: true });
});

roomsRouter.post('/:id/block', requirePerm('hk.supervise'), (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) throw notFound('Room');
  const reason = str(req.body.reason, 'Reason');
  tx(() => setBlock(req.user, room.id, 'Under Repair / Blocked', reason));
  res.json({ ok: true });
});

/** Housekeeping Supervisor decides when a blocked room may return (Part 1, s5.2). */
roomsRouter.post('/:id/release', requirePerm('hk.supervise'), (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) throw notFound('Room');
  if (room.block_status === 'None') throw bad('Room is not blocked.');
  const open = db.prepare("SELECT COUNT(*) AS c FROM room_defects WHERE room_id = ? AND status = 'Open'").get(room.id).c;
  if (open && !req.body.force) throw bad(`Room has ${open} unresolved defect(s). Resolve them first.`);
  tx(() => {
    setBlock(req.user, room.id, 'None', req.body.note || 'Released by supervisor');
    // A repaired room goes through the normal cleaning/inspection cycle.
    db.prepare('UPDATE rooms SET needs_inspection = 1 WHERE id = ?').run(room.id);
    if (room.hk_status === 'Clean') setHkStatus(req.user, room.id, 'For Inspection', 'Returned from repair');
  });
  res.json({ ok: true });
});
