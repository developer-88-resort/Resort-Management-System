// Authentication + Administration (users, rooms, configured rates, settings, audit trail).
import express from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import {
  authenticate, requirePerm, checkPassword, hashPassword, now, audit, bad, notFound, str, int, money, isDate,
  ROLES, permsOf, allSettings, setSetting, getSetting, tx, today,
} from '../lib.js';

export const authRouter = express.Router();

authRouter.post('/login', (req, res) => {
  const username = str(req.body.username, 'Username');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !u.active || !checkPassword(req.body.password ?? '', u.password_hash)) {
    audit(null, 'auth.login_failed', 'user', username);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const hours = getSetting('session_hours', 14);
  db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)')
    .run(token, u.id, now(), new Date(Date.now() + hours * 3600e3).toISOString());
  audit(u, 'auth.login', 'user', u.username);
  res.json({ token });
});

authRouter.use(authenticate);
authRouter.post('/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});
authRouter.get('/me', (req, res) => {
  res.json({ user: { ...req.user, role_label: ROLES[req.user.role] }, perms: permsOf(req.user), settings: publicSettings(), today: today() });
});
authRouter.post('/change-password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(req.body.current ?? '', u.password_hash)) throw bad('Current password is incorrect.');
  const pw = str(req.body.password, 'New password');
  if (pw.length < 6) throw bad('Password must be at least 6 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), u.id);
  audit(req.user, 'user.password_changed', 'user', u.username);
  res.json({ ok: true });
});

function publicSettings() {
  const s = allSettings();
  return s; // nothing secret is stored in settings
}

// ---------------------------------------------------------------------
export const adminRouter = express.Router();
adminRouter.use(authenticate);

// ---- users ----
adminRouter.get('/users', requirePerm('admin'), (_req, res) => {
  res.json({ users: db.prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username').all(), roles: ROLES });
});
adminRouter.post('/users', requirePerm('admin'), (req, res) => {
  const username = str(req.body.username, 'Username', { max: 40 }).toLowerCase();
  const full_name = str(req.body.full_name, 'Full name');
  const role = req.body.role;
  if (!ROLES[role]) throw bad('Invalid role.');
  const pw = str(req.body.password, 'Password');
  if (pw.length < 6) throw bad('Password must be at least 6 characters.');
  const id = db.prepare('INSERT INTO users(username, full_name, role, password_hash, created_at) VALUES(?,?,?,?,?)')
    .run(username, full_name, role, hashPassword(pw), now()).lastInsertRowid;
  audit(req.user, 'user.create', 'user', username, { to: { full_name, role } });
  res.json({ id: Number(id) });
});
adminRouter.put('/users/:id', requirePerm('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw notFound('User');
  const full_name = str(req.body.full_name ?? u.full_name, 'Full name');
  const role = req.body.role ?? u.role;
  if (!ROLES[role]) throw bad('Invalid role.');
  const active = req.body.active === undefined ? u.active : req.body.active ? 1 : 0;
  if (u.id === req.user.id && (!active || role !== 'admin')) throw bad('You cannot deactivate or demote your own account.');
  db.prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?').run(full_name, role, active, u.id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw bad('Password must be at least 6 characters.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(req.user, 'user.update', 'user', u.username, { from: { full_name: u.full_name, role: u.role, active: u.active }, to: { full_name, role, active, password_reset: !!req.body.password } });
  res.json({ ok: true });
});

// ---- room types & rooms ----
adminRouter.get('/room-types', requirePerm('rooms.view'), (_req, res) => {
  res.json({ types: db.prepare('SELECT * FROM room_types ORDER BY rate_per_night').all() });
});
adminRouter.post('/room-types', requirePerm('admin'), (req, res) => {
  const name = str(req.body.name, 'Category name');
  const rate = money(req.body.rate_per_night, 'Rate per night', { allowZero: false });
  const id = db.prepare('INSERT INTO room_types(name, rate_plan, rate_per_night, max_occupancy) VALUES(?,?,?,?)')
    .run(name, req.body.rate_plan || 'Standard', rate, int(req.body.max_occupancy, 'Max occupancy', { required: false })).lastInsertRowid;
  audit(req.user, 'room_type.create', 'room_type', id, { to: { name, rate } });
  res.json({ id: Number(id) });
});
adminRouter.put('/room-types/:id', requirePerm('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM room_types WHERE id = ?').get(req.params.id);
  if (!t) throw notFound('Room category');
  const next = {
    name: str(req.body.name ?? t.name, 'Category name'),
    rate_plan: req.body.rate_plan ?? t.rate_plan,
    rate_per_night: money(req.body.rate_per_night ?? t.rate_per_night, 'Rate per night', { allowZero: false }),
    max_occupancy: int(req.body.max_occupancy ?? t.max_occupancy, 'Max occupancy', { required: false }),
    active: req.body.active === undefined ? t.active : req.body.active ? 1 : 0,
  };
  const reason = str(req.body.reason, 'Reason for the change');
  db.prepare('UPDATE room_types SET name=?, rate_plan=?, rate_per_night=?, max_occupancy=?, active=? WHERE id=?')
    .run(next.name, next.rate_plan, next.rate_per_night, next.max_occupancy, next.active, t.id);
  audit(req.user, 'room_type.update', 'room_type', t.id, { from: t, to: next, reason });
  res.json({ ok: true });
});
adminRouter.post('/rooms', requirePerm('admin'), (req, res) => {
  const room_no = str(req.body.room_no, 'Room number', { max: 20 }).toUpperCase();
  const type = db.prepare('SELECT * FROM room_types WHERE id = ?').get(req.body.room_type_id);
  if (!type) throw bad('Choose a room category.');
  const id = db.prepare('INSERT INTO rooms(room_no, room_type_id) VALUES(?,?)').run(room_no, type.id).lastInsertRowid;
  audit(req.user, 'room.create', 'room', room_no, { to: { category: type.name } });
  res.json({ id: Number(id) });
});
adminRouter.put('/rooms/:id', requirePerm('admin'), (req, res) => {
  const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!r) throw notFound('Room');
  // Room IDs are permanent; only category and active flag change.
  const type_id = req.body.room_type_id ?? r.room_type_id;
  if (!db.prepare('SELECT 1 FROM room_types WHERE id = ?').get(type_id)) throw bad('Invalid category.');
  const active = req.body.active === undefined ? r.active : req.body.active ? 1 : 0;
  db.prepare('UPDATE rooms SET room_type_id = ?, active = ? WHERE id = ?').run(type_id, active, r.id);
  audit(req.user, 'room.update', 'room', r.room_no, { from: { room_type_id: r.room_type_id, active: r.active }, to: { room_type_id: type_id, active } });
  res.json({ ok: true });
});

// ---- configured rates (Day Tour categories & facilities) ----
adminRouter.get('/rates', requirePerm('rooms.view'), (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  res.json({ current: currentRates(date), history: db.prepare('SELECT * FROM rates ORDER BY code, effective_date DESC, id DESC').all() });
});
adminRouter.post('/rates', requirePerm('admin'), (req, res) => {
  const code = str(req.body.code, 'Code', { max: 20 }).toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const name = str(req.body.name, 'Name');
  const kind = req.body.kind === 'facility' ? 'facility' : 'guest';
  const amount = money(req.body.amount, 'Amount');
  if (!isDate(req.body.effective_date)) throw bad('Effective date is required.');
  const effective_date = req.body.effective_date;
  const reason = str(req.body.reason, 'Reason');
  const approver = str(req.body.approver, 'Approved by');
  const existing = db.prepare('SELECT * FROM rates WHERE code = ? ORDER BY id DESC').get(code);
  const id = db.prepare(`INSERT INTO rates(code, name, kind, counts_as_person, amount, effective_date, reason, approver, sort, active, created_by, created_at)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, name, kind, kind === 'guest' && req.body.counts_as_person !== false ? 1 : 0, amount, effective_date, reason, approver,
      int(req.body.sort ?? existing?.sort ?? 50, 'Sort'), req.body.active === false ? 0 : 1, req.user.username, now()).lastInsertRowid;
  audit(req.user, 'rate.create', 'rate', code, { from: existing ? { amount: existing.amount, effective_date: existing.effective_date } : null, to: { amount, effective_date }, reason, approver });
  res.json({ id: Number(id) });
});

export function currentRates(date) {
  return db.prepare(`SELECT r.* FROM rates r WHERE r.id = (
      SELECT r2.id FROM rates r2 WHERE r2.code = r.code AND r2.effective_date <= ? ORDER BY r2.effective_date DESC, r2.id DESC LIMIT 1)
    AND r.active = 1 ORDER BY r.kind DESC, r.sort, r.name`).all(date);
}

// ---- settings ----
adminRouter.get('/settings', requirePerm('admin'), (_req, res) => res.json({ settings: allSettings() }));
adminRouter.put('/settings', requirePerm('admin'), (req, res) => {
  const incoming = req.body.settings || {};
  const before = allSettings();
  tx(() => {
    for (const [k, v] of Object.entries(incoming)) {
      if (!(k in before)) continue; // only known keys
      if (JSON.stringify(before[k]) === JSON.stringify(v)) continue;
      setSetting(k, v);
      audit(req.user, 'setting.update', 'setting', k, { from: before[k], to: v, reason: req.body.reason });
    }
  });
  res.json({ settings: allSettings() });
});

// ---- audit trail ----
adminRouter.get('/audit', requirePerm('reports', 'admin'), (req, res) => {
  const where = [];
  const p = [];
  if (req.query.entity) { where.push('entity = ?'); p.push(req.query.entity); }
  if (req.query.entity_id) { where.push('entity_id = ?'); p.push(req.query.entity_id); }
  if (req.query.user) { where.push('username = ?'); p.push(req.query.user); }
  if (req.query.q) { where.push('(action LIKE ? OR entity_id LIKE ? OR reason LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (isDate(req.query.from)) { where.push('at >= ?'); p.push(new Date(req.query.from + 'T00:00:00').toISOString()); }
  if (isDate(req.query.to)) { where.push('at < ?'); p.push(new Date(req.query.to + 'T23:59:59.999').toISOString()); }
  const rows = db.prepare(`SELECT * FROM audit_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...p);
  res.json({ events: rows });
});
