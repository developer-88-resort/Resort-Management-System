// Approval requests (Part 2 Fig. 2, 5a): the cashier requests, status shows PENDING, the Front Office Supervisor
// approves from their own account, and only then does the action unlock. Approver, time and reason are logged.
import express from 'express';
import { db } from '../db.js';
import { authenticate, requirePerm, can, bad, notFound, conflict, HttpError, str, now, audit, tx } from '../lib.js';
import { refreshReservationStatus } from '../domain.js';

const refresh = (entity, id) => { if (entity === 'reservation') refreshReservationStatus(id); };

export const approvalsRouter = express.Router();
approvalsRouter.use(authenticate);

const TYPES = { transfer_waiver: 'Free upgrade waiver (room transfer)' };
const view = (a) => ({ ...a, payload: JSON.parse(a.payload), type_label: TYPES[a.type] || a.type });

approvalsRouter.get('/approvers', requirePerm('frontdesk', 'approve'), (_req, res) => {
  res.json({ approvers: db.prepare("SELECT username, full_name FROM users WHERE active = 1 AND role IN ('fo_supervisor','admin') ORDER BY role DESC, full_name").all() });
});

approvalsRouter.get('/', requirePerm('frontdesk', 'approve'), (req, res) => {
  const status = req.query.status || 'Pending';
  const mine = !can(req.user, 'approve');
  const rows = db.prepare(`SELECT * FROM approval_requests WHERE (? = 'All' OR status = ?) AND (? = 0 OR requested_by = ?) ORDER BY id DESC LIMIT 200`)
    .all(status, status, mine ? 1 : 0, req.user.username);
  res.json({ approvals: rows.map(view), pending: db.prepare("SELECT COUNT(*) AS c FROM approval_requests WHERE status = 'Pending'").get().c });
});

approvalsRouter.get('/:id', requirePerm('frontdesk', 'approve'), (req, res) => {
  const a = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(req.params.id);
  if (!a) throw notFound('Approval request');
  res.json({ approval: view(a) });
});

approvalsRouter.post('/', requirePerm('frontdesk'), (req, res) => {
  const type = req.body.type;
  if (!TYPES[type]) throw bad('Unknown approval type.');
  const entity = str(req.body.entity, 'Record');
  const entity_id = Number(req.body.entity_id);
  if (!Number.isInteger(entity_id)) throw bad('Record id is required.');
  const summary = str(req.body.summary, 'Summary', { max: 1000 });
  const reason = str(req.body.reason, 'Reason');
  const payload = req.body.payload || {};
  const id = tx(() => {
    // One open request per record and type: a new request replaces the old pending one.
    db.prepare(`UPDATE approval_requests SET status = 'Withdrawn', decided_at = ?, decision_note = 'Replaced by a new request'
                WHERE type = ? AND entity = ? AND entity_id = ? AND status = 'Pending'`).run(now(), type, entity, entity_id);
    const self = can(req.user, 'approve');
    const newId = Number(db.prepare(`INSERT INTO approval_requests(type, entity, entity_id, payload, summary, reason, requested_by, requested_at, approver_requested,
        status, decided_by, decided_at, decision_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(type, entity, entity_id, JSON.stringify(payload), summary, reason, req.user.username, now(), req.body.approver_requested || null,
        self ? 'Approved' : 'Pending', self ? req.user.username : null, self ? now() : null, self ? 'Requested and approved by supervisor' : null).lastInsertRowid);
    audit(req.user, 'approval.request', entity, entity_id, { to: { approval: newId, type, summary, status: self ? 'Approved' : 'Pending' }, reason });
    refresh(entity, entity_id);
    return newId;
  });
  res.json({ approval: view(db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id)) });
});

function decide(req, res, status) {
  const a = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(req.params.id);
  if (!a) throw notFound('Approval request');
  if (a.status !== 'Pending') throw conflict(`This request is already ${a.status}.`);
  const note = status === 'Rejected' ? str(req.body.note, 'Reason for rejecting') : (req.body.note || null);
  db.prepare('UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?').run(status, req.user.username, now(), note, a.id);
  audit(req.user, `approval.${status.toLowerCase()}`, a.entity, a.entity_id, { from: 'Pending', to: { approval: a.id, status }, reason: note || a.reason, approver: req.user.username });
  refresh(a.entity, a.entity_id);
  res.json({ approval: view(db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(a.id)) });
}
approvalsRouter.post('/:id/approve', requirePerm('approve'), (req, res) => decide(req, res, 'Approved'));
approvalsRouter.post('/:id/reject', requirePerm('approve'), (req, res) => decide(req, res, 'Rejected'));

/**
 * Uses an approved request exactly once. `match` fields must equal the request payload,
 * so an approval for one room cannot be reused for another.
 */
export function consumeApproval(approvalId, { type, entity, entity_id, match = {} }) {
  const a = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId);
  if (!a || a.type !== type || a.entity !== entity || a.entity_id !== entity_id)
    throw new HttpError(403, 'Approval request not found for this record.', { needsApproval: true });
  if (a.status === 'Pending') throw new HttpError(403, 'Waiting for supervisor approval.', { needsApproval: true });
  if (a.status !== 'Approved') throw new HttpError(403, `Approval was ${a.status}.`, { needsApproval: true });
  if (a.used_at) throw new HttpError(403, 'This approval was already used.', { needsApproval: true });
  const p = JSON.parse(a.payload);
  for (const [k, v] of Object.entries(match)) {
    if (String(p[k]) !== String(v)) throw new HttpError(403, 'The details changed after approval. Request approval again.', { needsApproval: true });
  }
  db.prepare('UPDATE approval_requests SET used_at = ? WHERE id = ?').run(now(), a.id);
  return a;
}
