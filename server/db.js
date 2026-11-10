// Central database (Part 1, Fig. 1). One shared record set, role-based access per department.
// All money columns are INTEGER centavos to avoid floating-point errors.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.IRMS_DATA_DIR || path.resolve(here, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.IRMS_DB || path.join(DATA_DIR, 'irms.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
  role TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY, value INTEGER NOT NULL);

-- Audit trail: who, what, when, from/to, why. Financial rows are never deleted.
CREATE TABLE IF NOT EXISTS audit_events(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, username TEXT, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, from_value TEXT, to_value TEXT, reason TEXT, approver TEXT);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_events(entity, entity_id);

CREATE TABLE IF NOT EXISTS guests(
  id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, contact_no TEXT, email TEXT, created_at TEXT NOT NULL);

-- Room inventory. Housekeeping status and block/availability are SEPARATE fields.
CREATE TABLE IF NOT EXISTS room_types(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, rate_plan TEXT, rate_per_night INTEGER NOT NULL,
  max_occupancy INTEGER, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS rooms(
  id INTEGER PRIMARY KEY, room_no TEXT UNIQUE NOT NULL, room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  hk_status TEXT NOT NULL DEFAULT 'Clean', block_status TEXT NOT NULL DEFAULT 'None', block_reason TEXT,
  needs_inspection INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, hk_updated_at TEXT, hk_updated_by TEXT);
CREATE TABLE IF NOT EXISTS room_defects(
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id), note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open', source TEXT, reported_by TEXT, reported_at TEXT NOT NULL,
  resolved_by TEXT, resolved_at TEXT, resolution TEXT);
CREATE TABLE IF NOT EXISTS housekeeping_log(
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL, field TEXT NOT NULL, from_status TEXT, to_status TEXT,
  by_user TEXT, at TEXT NOT NULL, note TEXT);

-- Reservations: reservation status and payment status are separate fields.
CREATE TABLE IF NOT EXISTS reservations(
  id INTEGER PRIMARY KEY, reference TEXT UNIQUE NOT NULL, guest_id INTEGER NOT NULL REFERENCES guests(id),
  source TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL,
  reservation_status TEXT NOT NULL, payment_status TEXT NOT NULL,
  down_payment_pct REAL NOT NULL, down_payment_due TEXT, remarks TEXT,
  id_type TEXT, id_ref TEXT, id_verified_by TEXT, id_verified_at TEXT, id_attachment_id INTEGER,
  cancel_reason TEXT, cancelled_by TEXT, cancelled_at TEXT,
  refund_decision TEXT, refund_note TEXT, refund_approver TEXT,
  is_opening_record INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS reservation_room_lines(
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id), room_id INTEGER REFERENCES rooms(id),
  rate_per_night INTEGER NOT NULL, effective_rate INTEGER NOT NULL,
  adults INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, seniors INTEGER NOT NULL DEFAULT 0, pwd INTEGER NOT NULL DEFAULT 0,
  line_status TEXT NOT NULL DEFAULT 'Active',
  hk_confirmed_at TEXT, hk_confirmed_by TEXT,
  signed_form_at TEXT, signed_form_by TEXT, signed_form_attachment_id INTEGER);
CREATE INDEX IF NOT EXISTS ix_lines_room ON reservation_room_lines(room_id, line_status);
CREATE TABLE IF NOT EXISTS guest_stays(
  id INTEGER PRIMARY KEY, line_id INTEGER UNIQUE NOT NULL REFERENCES reservation_room_lines(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id), occupancy_status TEXT NOT NULL,
  checked_in_at TEXT, checked_in_by TEXT, checked_out_at TEXT, checked_out_by TEXT,
  inspection_note TEXT, checkin_exception TEXT, checkout_exception TEXT);

-- Folio (one master folio per reservation; every charge keeps its room line - RM-05 open).
CREATE TABLE IF NOT EXISTS folio_charges(
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id), line_id INTEGER,
  kind TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT,
  reverses_id INTEGER, approver TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room_transfers(
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL, line_id INTEGER NOT NULL,
  from_room_id INTEGER NOT NULL, to_room_id INTEGER NOT NULL, stage TEXT NOT NULL,
  reason_type TEXT NOT NULL, reason TEXT NOT NULL, remarks TEXT,
  current_rate INTEGER NOT NULL, new_rate INTEGER NOT NULL, nights INTEGER NOT NULL,
  upgrade_value INTEGER NOT NULL, treatment TEXT NOT NULL, waived_by TEXT, payment_id INTEGER,
  original_room_next TEXT, created_by TEXT, created_at TEXT NOT NULL);

-- Departmental transactions (Restaurant, Mini Bar, Massage). One unique source ID each.
CREATE TABLE IF NOT EXISTS department_transactions(
  id INTEGER PRIMARY KEY, source_txn_id TEXT UNIQUE NOT NULL, department TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('direct','charge')),
  target_type TEXT, target_id INTEGER, target_line_id INTEGER, target_label TEXT,
  items TEXT NOT NULL, amount INTEGER NOT NULL, direct_tender TEXT, direct_reference TEXT,
  employee TEXT, note TEXT, reverses_txn_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_dept_target ON department_transactions(target_type, target_id);

-- Cashier and billing
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, payment_no TEXT UNIQUE NOT NULL, kind TEXT NOT NULL DEFAULT 'payment',
  account_type TEXT NOT NULL, account_id INTEGER NOT NULL, purpose TEXT, total INTEGER NOT NULL,
  cashier TEXT, note TEXT, paid_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_tenders(
  id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id), method TEXT NOT NULL,
  amount INTEGER NOT NULL, reference TEXT);
CREATE TABLE IF NOT EXISTS payment_allocations(
  id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id),
  target_type TEXT NOT NULL, target_id INTEGER NOT NULL, amount INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_alloc_target ON payment_allocations(target_type, target_id);
CREATE TABLE IF NOT EXISTS receipts(
  id INTEGER PRIMARY KEY, receipt_no TEXT UNIQUE NOT NULL, doc_type TEXT NOT NULL,
  payment_id INTEGER UNIQUE NOT NULL REFERENCES payments(id), issued_by TEXT, issued_at TEXT NOT NULL,
  reprint_count INTEGER NOT NULL DEFAULT 0, last_printed_at TEXT);
CREATE TABLE IF NOT EXISTS discount_lines(
  id INTEGER PRIMARY KEY, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, txn_ref TEXT,
  category TEXT NOT NULL, basis TEXT, vat_treatment TEXT, amount INTEGER NOT NULL,
  reason TEXT, approver TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments(
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, kind TEXT NOT NULL,
  filename TEXT NOT NULL, mime TEXT, path TEXT NOT NULL, restricted INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT, uploaded_at TEXT NOT NULL);

-- Configured rates (nothing hard-coded). Each change is a new row with an effective date.
CREATE TABLE IF NOT EXISTS rates(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  counts_as_person INTEGER NOT NULL DEFAULT 1, amount INTEGER NOT NULL, effective_date TEXT NOT NULL,
  reason TEXT, approver TEXT, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TEXT NOT NULL);

-- Day Tour (Part 3, Fig. 5)
CREATE TABLE IF NOT EXISTS day_tour_groups(
  id INTEGER PRIMARY KEY, reference TEXT UNIQUE NOT NULL, organizer_guest_id INTEGER REFERENCES guests(id),
  group_name TEXT NOT NULL, contact_no TEXT, booking_type TEXT NOT NULL, arrival_date TEXT NOT NULL,
  estimated_guests INTEGER NOT NULL DEFAULT 0, actual_guests INTEGER NOT NULL DEFAULT 0,
  rate_basis TEXT NOT NULL, agreement_ref TEXT, payment_terms TEXT NOT NULL,
  entry_exception_by TEXT, entry_exception_reason TEXT,
  group_status TEXT NOT NULL, remarks TEXT,
  cancel_reason TEXT, cancelled_by TEXT, cancelled_at TEXT,
  arrived_at TEXT, checked_out_at TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS group_guest_counts(
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES day_tour_groups(id),
  category_code TEXT NOT NULL, category_name TEXT NOT NULL, counts_as_person INTEGER NOT NULL,
  count INTEGER NOT NULL, rate INTEGER NOT NULL, rate_id INTEGER, rate_override_by TEXT,
  UNIQUE(group_id, category_code));
CREATE TABLE IF NOT EXISTS group_charges(
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES day_tour_groups(id),
  locker_account_id INTEGER, kind TEXT NOT NULL, description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1, rate INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL,
  rate_id INTEGER, reason TEXT, reverses_id INTEGER, approver TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lockers(
  id TEXT PRIMARY KEY, color TEXT NOT NULL, number INTEGER NOT NULL, section TEXT NOT NULL,
  locker_status TEXT NOT NULL DEFAULT 'Available', status_note TEXT, UNIQUE(color, number));
CREATE TABLE IF NOT EXISTS locker_accounts(
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES day_tour_groups(id),
  assignment_type TEXT NOT NULL, occupants TEXT, payer TEXT NOT NULL DEFAULT 'Representative',
  status TEXT NOT NULL DEFAULT 'Open', created_by TEXT, created_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE IF NOT EXISTS locker_assignments(
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES locker_accounts(id),
  locker_id TEXT NOT NULL REFERENCES lockers(id), group_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL, issued_by TEXT, key_returned_at TEXT, key_returned_by TEXT,
  ended_at TEXT, ended_by TEXT, end_reason TEXT);
-- Only one open assignment per physical locker (one group at a time).
CREATE UNIQUE INDEX IF NOT EXISTS ux_locker_open ON locker_assignments(locker_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS locker_incidents(
  id INTEGER PRIMARY KEY, locker_id TEXT NOT NULL, account_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
  type TEXT NOT NULL, penalty INTEGER NOT NULL DEFAULT 0, note TEXT, moved_to_locker_id TEXT,
  created_by TEXT, created_at TEXT NOT NULL);
`);

export function scalar(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? Object.values(row)[0] : undefined;
}

// ---------------------------------------------------------------------
// Additions (v0.2): approvals queue, reconciliation, attachments on charges.
// ---------------------------------------------------------------------
db.exec(`
-- Approval requests (Part 2 Fig. 2: Request Approval -> PENDING -> approved by supervisor).
CREATE TABLE IF NOT EXISTS approval_requests(
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  payload TEXT NOT NULL, summary TEXT NOT NULL, reason TEXT,
  requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, approver_requested TEXT,
  status TEXT NOT NULL DEFAULT 'Pending', decided_by TEXT, decided_at TEXT, decision_note TEXT,
  used_at TEXT);
CREATE INDEX IF NOT EXISTS ix_approval_status ON approval_requests(status);
-- Daily reconciliation during parallel running (Fixed decision 9).
CREATE TABLE IF NOT EXISTS reconciliations(
  id INTEGER PRIMARY KEY, business_date TEXT NOT NULL, lines TEXT NOT NULL, notes TEXT,
  total_variance INTEGER NOT NULL, prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL);
`);

function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('folio_charges', 'attachment_id', 'INTEGER');
addColumn('department_transactions', 'attachment_id', 'INTEGER');
addColumn('group_charges', 'attachment_id', 'INTEGER');
addColumn('room_transfers', 'approval_id', 'INTEGER');
addColumn('day_tour_groups', 'is_opening_record', 'INTEGER NOT NULL DEFAULT 0');
addColumn('discount_lines', 'id_verified', 'INTEGER NOT NULL DEFAULT 0');

addColumn('reservation_room_lines', 'arrived_at', 'TEXT');
addColumn('reservation_room_lines', 'arrived_by', 'TEXT');
addColumn('reservation_room_lines', 'arrival_note', 'TEXT');
addColumn('day_tour_groups', 'refund_decision', 'TEXT');
addColumn('day_tour_groups', 'refund_note', 'TEXT');
addColumn('day_tour_groups', 'refund_approver', 'TEXT');
