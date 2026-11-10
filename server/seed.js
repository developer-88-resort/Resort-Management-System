// Master data seeded on first run. All rates are SAMPLE values for layout only (OD-05, OD-06).
import { db, scalar } from './db.js';
import { hashPassword, now, setSetting, getSetting, today } from './lib.js';

const DEFAULT_SETTINGS = {
  // BIR identity & document types are TO CONFIRM (OD-13). Never invented; set by Accounting.
  business_name: '88 HOTSPRING RESORT & HOTEL',
  business_address: '[Business address per BIR registration - OD-13]',
  business_tin: '[TIN per BIR registration - OD-13]',
  receipt_prefix: 'OR-',
  receipt_doc_types: { default: 'Official Receipt' },
  receipt_footer: 'Thank you for staying with us!',
  terminal_id: 'FO-1',
  // Payment methods list from Front Office (RM-04 still open: Maya, credit/debit, Korean Bank currency).
  payment_methods: ['Cash', 'Card', 'GCash', 'Bank Transfer', 'Korean Bank'],
  // Reservation deposit (FO-RSV-04, OD-02)
  down_payment_pct: 30,
  down_payment_due_days: 3,
  // Reservation sources
  reservation_sources: ['Facebook / Messenger', 'Website', 'Phone call', 'Walk-in', 'Travel agency', 'Other'],
  // RM-01: reservation status while only some rooms are checked in
  rm01_partial_checkin_status: 'active_until_last',
  // Check-in gate (proposed). Signed form required before Confirm Check-in.
  checkin_require_signed_form: true,
  // OD-04: 'all' = every turnover needs For Inspection; 'defect_only' = only rooms that were blocked/repaired
  hk_inspection_rule: 'defect_only',
  // RT-05 reason lists (proposed, Front Office to finalise)
  transfer_reasons_fault: ['Aircon not working', 'Plumbing / water issue', 'Electrical issue', 'Cleanliness issue', 'Noise / pest', 'Other defect'],
  transfer_reasons_guest: ['Wants a larger room', 'Wants a different view', 'Additional guests', 'Wants a different bed type', 'Other request'],
  // Day Tour
  daytour_payment_terms: ['Pay on arrival', 'No advance', 'Down payment', 'Full advance'],
  daytour_rate_bases: ['Standard walk-in rates', 'Special / agreement rate'],
  lost_key_penalty_min: 50000, // centavos, PHP 500 (OD-14)
  lost_key_penalty_max: 100000, // PHP 1,000
  locker_count_per_color: 400,
  discount_categories: ['Senior Citizen', 'PWD', 'Management approved', 'Promo'],
  // Payment status labels: 'part1' = Part 1 s4.2 (Checked In: Balance Due / Settled; Refund Completed),
  // 'part3' = Part 3 s2.2 (Unpaid / Partially Paid / Paid; Refunded). Labels to be matched to WinCloud (PROPOSED).
  payment_status_labels: 'part1',
  // Phase 1: Front Office confirms readiness with Housekeeping and ticks it. Turn off when the Housekeeping
  // module goes live and management approves removing the step (Part 1 s3.1, Part 3 s5 phase 3).
  fo_confirms_housekeeping: true,
};

const USERS = [
  ['admin', 'System Administrator', 'admin'],
  ['fosup', 'Front Office Supervisor', 'fo_supervisor'],
  ['cashier', 'Front Office Cashier', 'fo_cashier'],
  ['marketing', 'Marketing Staff', 'marketing'],
  ['hk', 'Housekeeping Staff', 'housekeeping'],
  ['hksup', 'Housekeeping Supervisor', 'hk_supervisor'],
  ['restaurant', 'Restaurant Cashier', 'restaurant'],
  ['minibar', 'Mini Bar Attendant', 'minibar'],
  ['massage', 'Massage Desk', 'massage'],
  ['accounting', 'Accounting', 'accounting'],
];

export function seed() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (getSetting(k) === undefined) setSetting(k, v);

  if (!scalar('SELECT COUNT(*) AS v FROM users')) {
    const ins = db.prepare('INSERT INTO users(username, full_name, role, password_hash, created_at) VALUES(?,?,?,?,?)');
    for (const [u, n, r] of USERS) ins.run(u, n, r, hashPassword(u === 'admin' ? 'admin123' : `${u}123`), now());
    console.log('[seed] Users created. Default passwords: admin/admin123, <username>/<username>123 - change them in Administration > Users.');
  }

  if (!scalar('SELECT COUNT(*) AS v FROM room_types')) {
    const insT = db.prepare('INSERT INTO room_types(name, rate_plan, rate_per_night, max_occupancy) VALUES(?,?,?,?)');
    const insR = db.prepare('INSERT INTO rooms(room_no, room_type_id) VALUES(?,?)');
    const types = [['Villa', 'Standard', 600000, 4, 'VR1', 10], ['Deluxe', 'Standard', 850000, 3, 'DX2', 10], ['Family', 'Standard', 1000000, 6, 'FM3', 6]];
    for (const [name, plan, rate, occ, prefix, n] of types) {
      const id = Number(insT.run(name, plan, rate, occ).lastInsertRowid);
      for (let i = 1; i <= n; i++) insR.run(`${prefix}${String(i).padStart(2, '0')}`, id);
    }
  }

  if (!scalar('SELECT COUNT(*) AS v FROM rates')) {
    const ins = db.prepare(`INSERT INTO rates(code, name, kind, counts_as_person, amount, effective_date, reason, approver, sort, created_by, created_at)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const eff = '2026-01-01';
    const rows = [
      ['ADULT', 'Regular Adult', 'guest', 1, 50000, 1], ['CHILD', 'Child', 'guest', 1, 30000, 2],
      ['SENIOR', 'Senior Citizen', 'guest', 1, 50000, 3], ['PWD', 'PWD', 'guest', 1, 50000, 4],
      ['PET', 'Pet', 'guest', 0, 10000, 5],
      ['KUBO', 'Kubo', 'facility', 0, 150000, 10], ['COTTAGE', 'Cottage', 'facility', 0, 250000, 11],
    ];
    for (const [code, name, kind, person, amt, sort] of rows) ins.run(code, name, kind, person, amt, eff, 'Initial SAMPLE rate - replace with approved rates (OD-06)', 'system', sort, 'system', now());
  }

  if (!scalar('SELECT COUNT(*) AS v FROM lockers')) {
    const n = getSetting('locker_count_per_color', 400);
    const ins = db.prepare('INSERT INTO lockers(id, color, number, section) VALUES(?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 1; i <= n; i++) {
      ins.run(`RED-${String(i).padStart(3, '0')}`, 'Red', i, 'Female');
      ins.run(`BLUE-${String(i).padStart(3, '0')}`, 'Blue', i, 'Male');
    }
    db.exec('COMMIT');
  }
  void today;
}
