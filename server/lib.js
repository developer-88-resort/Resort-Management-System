import crypto from 'node:crypto';
import { db, scalar } from './db.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (msg, details) => new HttpError(400, msg, details);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
export const conflict = (msg, details) => new HttpError(409, msg, details);

// ---------- time ----------
export const now = () => new Date().toISOString();
export function localDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export const today = () => localDate();
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}
export function nightsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const maxDate = (a, b) => (a > b ? a : b);

// ---------- validation ----------
export function str(v, name, { required = true, max = 500 } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} is too long.`);
  return s;
}
export function int(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number${min > 0 ? ` of at least ${min}` : ''}.`);
  return n;
}
/** Money in centavos (integer). */
export function money(v, name, { min = 0, allowZero = true } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} must be an amount in centavos.`);
  if (n < min || (!allowZero && n === 0)) throw bad(`${name} must be greater than ${min === 0 && !allowZero ? 'zero' : min}.`);
  return n;
}
export const oneOf = (v, list, name) => {
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}.`);
  return v;
};

// ---------- transactions ----------
let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

// ---------- numbering ----------
export function nextNo(name, prefix, width = 6) {
  db.prepare('INSERT INTO counters(name, value) VALUES(?, 0) ON CONFLICT(name) DO NOTHING').run(name);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
  const v = scalar('SELECT value FROM counters WHERE name = ?', name);
  return `${prefix}${String(v).padStart(width, '0')}`;
}

// ---------- settings ----------
export function getSetting(key, fallback) {
  const v = scalar('SELECT value FROM settings WHERE key = ?', key);
  if (v === undefined) return fallback;
  try { return JSON.parse(v); } catch { return v; }
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
export function allSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

// ---------- audit ----------
const j = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));
export function audit(user, action, entity, entityId, { from, to, reason, approver } = {}) {
  db.prepare(`INSERT INTO audit_events(at, user_id, username, action, entity, entity_id, from_value, to_value, reason, approver)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(now(), user?.id ?? null, user?.username ?? 'system', action, entity, entityId == null ? null : String(entityId),
      j(from), j(to), reason ?? null, approver ?? null);
}

// ---------- passwords & sessions ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- roles & permissions ----------
export const ROLES = {
  admin: 'Administrator',
  fo_supervisor: 'Front Office Supervisor',
  fo_cashier: 'Front Office / Cashier',
  marketing: 'Marketing',
  housekeeping: 'Housekeeping',
  hk_supervisor: 'Housekeeping Supervisor',
  restaurant: 'Restaurant',
  minibar: 'Mini Bar',
  massage: 'Massage',
  accounting: 'Accounting / Management',
};
export const DEPARTMENT_OF_ROLE = { restaurant: 'Restaurant', minibar: 'Mini Bar', massage: 'Massage' };

const PERMS = {
  'reservation.view': ['admin', 'fo_supervisor', 'fo_cashier', 'marketing', 'accounting'],
  'reservation.edit': ['admin', 'fo_supervisor', 'fo_cashier', 'marketing'],
  frontdesk: ['admin', 'fo_supervisor', 'fo_cashier'],
  daytour: ['admin', 'fo_supervisor', 'fo_cashier'],
  'daytour.view': ['admin', 'fo_supervisor', 'fo_cashier', 'accounting'],
  'rooms.view': Object.keys(ROLES),
  housekeeping: ['admin', 'fo_supervisor', 'fo_cashier', 'housekeeping', 'hk_supervisor'],
  'hk.supervise': ['admin', 'hk_supervisor', 'fo_supervisor'],
  department: ['admin', 'fo_supervisor', 'restaurant', 'minibar', 'massage'],
  reports: ['admin', 'fo_supervisor', 'accounting'],
  approve: ['admin', 'fo_supervisor'],
  admin: ['admin'],
};
export const can = (user, perm) => !!user && (PERMS[perm] || []).includes(user.role);
export const permsOf = (user) => Object.keys(PERMS).filter((p) => can(user, p));

export function authenticate(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please sign in.'));
  const row = db.prepare(`SELECT u.id, u.username, u.full_name, u.role, u.active, s.expires_at
                          FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row || !row.active || row.expires_at < now()) return next(new HttpError(401, 'Session expired. Please sign in again.'));
  req.user = { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
  req.token = token;
  next();
}
export const requirePerm = (...perms) => (req, _res, next) =>
  perms.some((p) => can(req.user, p)) ? next() : next(new HttpError(403, 'Your role does not have access to this function.'));

/**
 * Supervisor approval. If the signed-in user is an approver they approve as themselves;
 * otherwise the approver's username + password must be supplied (supervisor override).
 * Returns the approver's username for the audit trail.
 */
export function verifyApproval(req, approval, what = 'This action') {
  if (can(req.user, 'approve')) return req.user.username;
  const username = approval?.username?.trim();
  const password = approval?.password;
  if (!username || !password) throw new HttpError(403, `${what} needs Front Office Supervisor approval.`, { needsApproval: true });
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!u || !checkPassword(password, u.password_hash) || !can(u, 'approve'))
    throw new HttpError(403, 'Approval rejected: invalid supervisor credentials.', { needsApproval: true });
  return u.username;
}

/** Local calendar day -> ISO timestamp range [start, end) for querying stored ISO timestamps. */
export const dayStartIso = (d) => new Date(`${d}T00:00:00`).toISOString();
export const dayEndIso = (d) => new Date(`${addDays(d, 1)}T00:00:00`).toISOString();
