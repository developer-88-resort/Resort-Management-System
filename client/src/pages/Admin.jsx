// Administration: users & roles, rooms & categories, configured Day Tour rates, settings, audit trail.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, Modal, Open, Panel, useAction, useLoad } from '../components/ui.jsx';
import { Icon, ReservationActionLabel } from '../components/Design.jsx';
import { centsToInput, fmtDate, fmtDateTime, localToday, peso, toCents } from '../util.js';

// ------------------------------------------------------------------ users
export function AdminUsers() {
  const [d, reload, err] = useLoad('/admin/users');
  const [edit, setEdit] = useState(null);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  return (
    <div className="stack">
      <div className="pagehead"><h1>Users & Roles</h1><span className="sp" /><button type="button" className="btn gold reservation-action" onClick={() => setEdit({ username: '', full_name: '', role: 'fo_cashier', password: '', active: true })}><ReservationActionLabel icon="userProfile">New user</ReservationActionLabel></button></div>
      <div className="panel"><table className="tbl"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
        <tbody>{d.users.map((u) => (
          <tr key={u.id}><td className="mono">{u.username}</td><td>{u.full_name}</td><td>{d.roles[u.role]}</td><td><Badge t={u.active ? 'green' : 'grey'}>{u.active ? 'Active' : 'Inactive'}</Badge></td>
            <td>{fmtDate(u.created_at)}</td><td><button className="linkbtn" onClick={() => setEdit({ ...u, active: !!u.active, password: '' })}>edit</button></td></tr>
        ))}</tbody></table></div>
      <div className="note small">Role access follows Part 1: Marketing creates and edits reservations; Front Office runs check-in, cashier and Day Tour; departments post their own sales; the Front Office Supervisor approves waivers, exceptions, voids and refunds. Administration scope is still open <Open id="OD-19" />.</div>
      {edit && <UserModal u={edit} roles={d.roles} onClose={() => setEdit(null)} onDone={reload} />}
    </div>
  );
}
function UserModal({ u, roles, onClose, onDone }) {
  const [f, setF] = useState(u);
  const a = useAction();
  return (
    <Modal title={u.id ? `Edit ${u.username}` : 'New user'} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { u.id ? await api.put(`/admin/users/${u.id}`, f) : await api.post('/admin/users', f); await onDone(); onClose(); })}>Save</button></>}>
      <div className="grid g2">
        <Field label="Username"><input value={f.username} disabled={!!u.id} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Full name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={u.id ? 'New password (leave blank to keep)' : 'Password'}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
      </div>
      {u.id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
      <ErrorBox error={a.error} />
    </Modal>
  );
}

// ------------------------------------------------------------------ rooms
export function AdminRooms() {
  const [types, reloadTypes] = useLoad('/admin/room-types');
  const [rooms, reloadRooms] = useLoad('/rooms');
  const [editType, setEditType] = useState(null);
  const [newRoom, setNewRoom] = useState({ room_no: '', room_type_id: '' });
  const a = useAction();
  return (
    <div className="stack">
      <div className="pagehead"><h1>Rooms & Categories</h1><span className="sp" /><span className="muted small">Room inventory, categories and rates are TO CONFIRM (OD-05). Sample values are seeded.</span></div>
      <div className="grid g2">
        <Panel title="Room categories" right={<button type="button" className="btn sm category-create" onClick={() => setEditType({ name: '', rate_plan: 'Standard', rate_per_night: '', max_occupancy: '' })}><Icon name="categories" size={16} /><span>Category</span></button>}>
          <table className="tbl"><thead><tr><th>Category</th><th>Rate plan</th><th className="right">Rate / night</th><th className="right">Max</th><th>Status</th><th /></tr></thead>
            <tbody>{types?.types.map((t) => (
              <tr key={t.id}><td><b>{t.name}</b></td><td>{t.rate_plan}</td><td className="num">{peso(t.rate_per_night)}</td><td className="num">{t.max_occupancy ?? '-'}</td><td>{t.active ? 'Active' : 'Inactive'}</td>
                <td><button className="linkbtn" onClick={() => setEditType({ ...t, rate_per_night: centsToInput(t.rate_per_night) })}>edit</button></td></tr>
            ))}</tbody></table>
        </Panel>
        <Panel title="Add room">
          <div className="grid g3" style={{ alignItems: 'end' }}>
            <Field label="Room number (permanent ID)"><input value={newRoom.room_no} onChange={(e) => setNewRoom({ ...newRoom, room_no: e.target.value.toUpperCase() })} /></Field>
            <Field label="Category"><select value={newRoom.room_type_id} onChange={(e) => setNewRoom({ ...newRoom, room_type_id: e.target.value })}><option value="">Choose…</option>{types?.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <button className="btn" disabled={!newRoom.room_no || !newRoom.room_type_id} onClick={() => a.run(async () => { await api.post('/admin/rooms', newRoom); setNewRoom({ room_no: '', room_type_id: '' }); await reloadRooms(); })}>Add</button>
          </div>
          <ErrorBox error={a.error} />
        </Panel>
      </div>
      <Panel title={`Rooms (${rooms?.rooms.length || 0})`}>
        <table className="tbl"><thead><tr><th>Room</th><th>Category</th><th>Housekeeping</th><th>Block</th><th>Availability now</th><th>Change category</th></tr></thead>
          <tbody>{rooms?.rooms.map((r) => (
            <tr key={r.id}><td><b>{r.room_no}</b></td><td>{r.category}</td><td><Badge>{r.hk_status}</Badge></td><td>{r.block_status}</td><td><Badge>{r.availability}</Badge></td>
              <td><select value={r.room_type_id} onChange={(e) => a.run(async () => { await api.put(`/admin/rooms/${r.id}`, { room_type_id: Number(e.target.value) }); await reloadRooms(); })} style={{ width: 'auto' }}>
                {types?.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td></tr>
          ))}</tbody></table>
      </Panel>
      {editType && <TypeModal t={editType} onClose={() => setEditType(null)} onDone={async () => { await reloadTypes(); await reloadRooms(); }} />}
    </div>
  );
}
function TypeModal({ t, onClose, onDone }) {
  const [f, setF] = useState({ ...t, reason: '' });
  const a = useAction();
  return (
    <Modal title={t.id ? `Edit ${t.name}` : 'New category'} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => {
        const body = { ...f, rate_per_night: toCents(f.rate_per_night), max_occupancy: f.max_occupancy === '' ? null : Number(f.max_occupancy) };
        t.id ? await api.put(`/admin/room-types/${t.id}`, body) : await api.post('/admin/room-types', body);
        await onDone(); onClose();
      })}>Save</button></>}>
      <div className="grid g2">
        <Field label="Category name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Rate plan"><input value={f.rate_plan || ''} onChange={(e) => setF({ ...f, rate_plan: e.target.value })} /></Field>
        <Field label="Rate per night"><input className="num" value={f.rate_per_night} onChange={(e) => setF({ ...f, rate_per_night: e.target.value })} /></Field>
        <Field label="Max occupancy"><input type="number" value={f.max_occupancy ?? ''} onChange={(e) => setF({ ...f, max_occupancy: e.target.value })} /></Field>
      </div>
      {t.id && <Field label="Reason for change (required)"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
      <p className="small muted">A new rate applies to new bookings. Existing reservations keep the rate they were booked at.</p>
      <ErrorBox error={a.error} />
    </Modal>
  );
}

// ------------------------------------------------------------------ rates
export function AdminRates() {
  const [d, reload, err] = useLoad('/admin/rates');
  const [f, setF] = useState(null);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  return (
    <div className="stack">
      <div className="pagehead"><h1>Day Tour Rates</h1><span className="sp" />
        <button type="button" className="btn gold reservation-action" onClick={() => setF({ code: '', name: '', kind: 'guest', counts_as_person: true, amount: '', effective_date: localToday(), reason: '', approver: '' })}><ReservationActionLabel icon="rateTag">New rate item</ReservationActionLabel></button></div>
      <div className="note">Rates come from this configured table with effective date, reason and approver. Nothing is hard-coded. A change is a new version; history is kept. Final rates, tax treatment and packages: <Open id="OD-06" />. Seeded values are SAMPLE DATA.</div>
      <Panel title="Current rates (today)">
        <table className="tbl"><thead><tr><th>Code</th><th>Item</th><th>Kind</th><th>Counted as guest</th><th className="right">Amount</th><th>Effective</th><th>Approved by</th><th /></tr></thead>
          <tbody>{d.current.map((r) => (
            <tr key={r.id}><td className="mono">{r.code}</td><td>{r.name}</td><td>{r.kind}</td><td>{r.kind === 'guest' ? (r.counts_as_person ? 'Yes' : 'No') : '-'}</td><td className="num">{peso(r.amount)}</td><td>{fmtDate(r.effective_date)}</td><td>{r.approver}</td>
              <td><button className="linkbtn" onClick={() => setF({ code: r.code, name: r.name, kind: r.kind, counts_as_person: !!r.counts_as_person, amount: centsToInput(r.amount), effective_date: localToday(), reason: '', approver: '', sort: r.sort })}>new version</button></td></tr>
          ))}</tbody></table>
      </Panel>
      <Panel title="Rate history">
        <table className="tbl"><thead><tr><th>Code</th><th className="right">Amount</th><th>Effective</th><th>Reason</th><th>Approver</th><th>Entered</th></tr></thead>
          <tbody>{d.history.map((r) => <tr key={r.id}><td className="mono">{r.code}</td><td className="num">{peso(r.amount)}</td><td>{fmtDate(r.effective_date)}</td><td className="small">{r.reason}</td><td>{r.approver}</td><td className="small">{r.created_by} {fmtDateTime(r.created_at)}</td></tr>)}</tbody></table>
      </Panel>
      {f && <RateModal f={f} setF={setF} onDone={reload} />}
    </div>
  );
}
function RateModal({ f, setF, onDone }) {
  const a = useAction();
  const close = () => setF(null);
  return (
    <Modal title="Rate version" onClose={close} footer={<><button className="btn outline" onClick={close}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api.post('/admin/rates', { ...f, amount: toCents(f.amount) }); await onDone(); close(); })}>Save rate</button></>}>
      <div className="grid g2">
        <Field label="Code"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="ADULT" /></Field>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="guest">Guest category</option><option value="facility">Facility charge item</option></select></Field>
        <Field label="Amount"><input className="num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Effective date"><input type="date" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} /></Field>
        <Field label="Approved by"><input value={f.approver} onChange={(e) => setF({ ...f, approver: e.target.value })} /></Field>
      </div>
      {f.kind === 'guest' && <label className="check"><input type="checkbox" checked={f.counts_as_person} onChange={(e) => setF({ ...f, counts_as_person: e.target.checked })} /> Counted in actual guests (untick for Pet)</label>}
      <Field label="Reason"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <ErrorBox error={a.error} />
    </Modal>
  );
}

// ------------------------------------------------------------------ settings
const SETTING_LABELS = {
  business_name: ['Business name (BIR)', 'text', 'OD-13'], business_address: ['Business address (BIR)', 'text', 'OD-13'], business_tin: ['TIN (BIR)', 'text', 'OD-13'],
  receipt_prefix: ['Receipt number prefix', 'text', 'OD-13'], receipt_doc_types: ['Document type per payment purpose (JSON)', 'json', 'OD-13'], receipt_footer: ['Receipt footer', 'text'],
  terminal_id: ['Terminal ID', 'text'], payment_methods: ['Payment methods (one per line)', 'list', 'RM-04'],
  down_payment_pct: ['Down payment % requested', 'number', 'OD-02'], down_payment_due_days: ['Down payment due (days after booking)', 'number', 'OD-02'],
  reservation_sources: ['Reservation sources (one per line)', 'list'],
  rm01_partial_checkin_status: ['Reservation status while partly checked in', 'select:active_until_last|checked_in_on_first', 'RM-01'],
  checkin_require_signed_form: ['Require signed registration form before check-in', 'bool', 'RM-03'],
  hk_inspection_rule: ['Housekeeping inspection rule', 'select:defect_only|all', 'OD-04'],
  transfer_reasons_fault: ['Transfer reasons: fault on resort side', 'list', 'RT-05'], transfer_reasons_guest: ['Transfer reasons: guest request', 'list', 'RT-05'],
  daytour_payment_terms: ['Day Tour payment terms', 'list'], daytour_rate_bases: ['Day Tour rate bases', 'list', 'OD-07'],
  lost_key_penalty_min: ['Lost key penalty minimum (centavos)', 'number', 'OD-14'], lost_key_penalty_max: ['Lost key penalty maximum (centavos)', 'number', 'OD-14'],
  discount_categories: ['Discount categories', 'list', 'OD-09'], session_hours: ['Session length (hours)', 'number'],
  payment_status_labels: ['Payment status labels (part1 = Part 1 s4.2, part3 = Part 3 s2.2)', 'select:part1|part3'],
  fo_confirms_housekeeping: ['Front Office ticks Housekeeping readiness (turn off when the Housekeeping module is live)', 'bool'],
};
export function AdminSettings() {
  const { refresh } = useAuth();
  const [d, reload, err] = useLoad('/admin/settings');
  const [f, setF] = useState(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);
  const a = useAction();
  useEffect(() => { if (d) setF(d.settings); }, [d]);
  if (err) return <ErrorBox error={err} />;
  if (!f) return <p>Loading…</p>;
  const save = () => a.run(async () => {
    const out = {};
    for (const [k, [, type]] of Object.entries(SETTING_LABELS)) {
      if (!(k in f)) continue;
      let v = f[k];
      if (type === 'list' && typeof v === 'string') v = v.split('\n').map((x) => x.trim()).filter(Boolean);
      if (type === 'number') v = Number(v);
      if (type === 'json' && typeof v === 'string') v = JSON.parse(v);
      out[k] = v;
    }
    await api.put('/admin/settings', { settings: out, reason });
    await reload(); await refresh(); setSaved(true);
  });
  return (
    <div className="stack">
      <div className="pagehead"><h1>Settings</h1><span className="sp" /><span className="muted small">Open decisions are built as settings so the rule can change without code.</span></div>
      <div className="panel grid g2">
        {Object.entries(SETTING_LABELS).filter(([k]) => k in f).map(([k, [label, type, od]]) => {
          const v = f[k];
          const set = (x) => { setSaved(false); setF({ ...f, [k]: x }); };
          let input;
          if (type === 'list') input = <textarea value={Array.isArray(v) ? v.join('\n') : v} onChange={(e) => set(e.target.value)} />;
          else if (type === 'json') input = <textarea className="mono" value={typeof v === 'string' ? v : JSON.stringify(v, null, 1)} onChange={(e) => set(e.target.value)} />;
          else if (type === 'bool') input = <label className="check"><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} /> Enabled</label>;
          else if (type.startsWith('select:')) input = <select value={v} onChange={(e) => set(e.target.value)}>{type.slice(7).split('|').map((o) => <option key={o}>{o}</option>)}</select>;
          else input = <input type={type === 'number' ? 'number' : 'text'} value={v} onChange={(e) => set(e.target.value)} />;
          return <Field key={k} label={label} hint={od && <Open id={od} />}>{input}</Field>;
        })}
      </div>
      <div className="actionbar">
        <Field label="Reason for the change (audit)"><input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 360 }} /></Field>
        <span className="sp" />{saved && <span className="okmsg">Saved.</span>}<ErrorBox error={a.error} />
        <button className="btn gold" disabled={a.busy} onClick={save}>Save settings</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ audit
export function AdminAudit() {
  const [q, setQ] = useState('');
  const [user, setUser] = useState('');
  const [from, setFrom] = useState(localToday());
  const [to, setTo] = useState(localToday());
  const p = new URLSearchParams({ from, to });
  if (q) p.set('q', q);
  if (user) p.set('user', user);
  const [d, , err] = useLoad(`/admin/audit?${p}`);
  return (
    <div className="stack">
      <div className="pagehead"><h1>Audit Trail</h1><span className="sp" /><span className="muted small">Who, what, when, from / to and why. Financial records are never silently deleted.</span></div>
      <div className="panel grid g4">
        <Field label="Search action / record / reason"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="User"><input value={user} onChange={(e) => setUser(e.target.value)} /></Field>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <ErrorBox error={err} />
      <div className="panel tablewrap">
        <table className="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>From</th><th>To</th><th>Reason</th><th>Approver</th></tr></thead>
          <tbody>{(d?.events || []).map((e) => (
            <tr key={e.id}><td className="nowrap small">{fmtDateTime(e.at)}</td><td>{e.username}</td><td className="mono small">{e.action}</td><td className="small">{e.entity} {e.entity_id}</td>
              <td className="mono small" style={{ maxWidth: 260, wordBreak: 'break-all' }}>{e.from_value?.slice(0, 200)}</td><td className="mono small" style={{ maxWidth: 320, wordBreak: 'break-all' }}>{e.to_value?.slice(0, 300)}</td>
              <td className="small">{e.reason}</td><td>{e.approver}</td></tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}
