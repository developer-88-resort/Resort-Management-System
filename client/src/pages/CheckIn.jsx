import { Icon } from '../components/Design.jsx';
// Room check-in (Part 2, Fig. 1): several rooms, per-room readiness, registration, split-tender payment, 4-item gate.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { askConfirm } from '../components/notify.jsx';
import { api, fileToPayload, attachmentUrl } from '../api.js';
import { ApprovalFields, Badge, Check, ErrorBox, Field, Modal, Open, Panel, Proposed, TenderEntry, useAction, useLoad } from '../components/ui.jsx';
import { fmtDate, fmtTime, guestsLabel, peso } from '../util.js';
import { useAuth } from '../auth.jsx';

const ID_TYPES = ["Driver's license", 'Passport', 'UMID', 'PhilSys National ID', 'SSS / GSIS', 'PRC ID', 'Postal ID', "Voter's ID", 'Senior Citizen ID', 'PWD ID', 'Other'];

export function ReservationSearch({ current }) {
  const nav = useNavigate();
  const [q, setQ] = useState({ name: '', ref: '', contact: '' });
  const [res, setRes] = useState(null);
  const search = async () => {
    const term = q.ref || q.name || q.contact;
    if (!term) return;
    const d = await api.get(`/reservations?q=${encodeURIComponent(term)}`);
    setRes(d.reservations.filter((r) => ['Active / Booked', 'Checked In'].includes(r.reservation_status)));
  };
  return (
    <Panel num={1} title="Reservation search" right={current && <span className="small" style={{ color: 'var(--teal)', fontWeight: 600 }}>{current}</span>}>
      <div className="grid g4" style={{ alignItems: 'end' }}>
        <Field label="Guest Name"><input value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && search()} /></Field>
        <Field label="Reservation Reference"><input value={q.ref} onChange={(e) => setQ({ ...q, ref: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && search()} /></Field>
        <Field label="Contact Number"><input value={q.contact} onChange={(e) => setQ({ ...q, contact: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && search()} /></Field>
        <button className="btn" onClick={search}>Search Reservation</button>
      </div>
      {res && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <tbody>{res.map((r) => (
            <tr key={r.id} className="click" onClick={() => { setRes(null); nav(`/reservations/${r.id}/checkin`); }}>
              <td><b>{r.reference}</b></td><td>{r.full_name}</td><td>{fmtDate(r.check_in)} to {fmtDate(r.check_out)}</td><td>{r.rooms}</td><td><Badge>{r.reservation_status}</Badge></td><td className="num">{peso(r.totals.outstanding)}</td><td className="right"><span className="btn sm outline">Start Check-in</span></td>
            </tr>))}
            {!res.length && <tr><td className="muted">No active reservation found.</td></tr>}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export default function CheckIn() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings } = useAuth();
  const [d, , err, setD] = useLoad(`/reservations/${id}`);
  const [sel, setSel] = useState([]);
  const [idf, setIdf] = useState({ id_type: ID_TYPES[0], id_ref: '', verified: false, file: null });
  const [formFile, setFormFile] = useState(null);
  const [paper, setPaper] = useState(false);
  const [formLines, setFormLines] = useState([]);
  const [exc, setExc] = useState(null);
  const [done, setDone] = useState(null);
  const [paid, setPaid] = useState(null);
  const a = useAction();

  useEffect(() => {
    if (!d) return;
    if (d.reservation.id_type) setIdf((f) => ({ ...f, id_type: d.reservation.id_type, id_ref: d.reservation.id_ref || '', verified: !!d.reservation.id_verified_at }));
    setSel((s) => s.filter((lid) => d.lines.find((l) => l.id === lid && l.line_status === 'Active' && l.ready)));
    setFormLines((s) => (s.length ? s : d.lines.filter((l) => l.line_status === 'Active' && !l.signed_form_at).map((l) => l.id)));
  }, [d]);

  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const r = d.reservation;
  const pending = d.lines.filter((l) => l.line_status === 'Active');
  const toggle = (lid) => setSel(sel.includes(lid) ? sel.filter((x) => x !== lid) : [...sel, lid]);
  const selLines = d.lines.filter((l) => sel.includes(l.id));
  const counts = d.lines.filter((l) => l.line_status !== 'Cancelled').reduce((s, l) => ({ adults: s.adults + l.adults, children: s.children + l.children, seniors: s.seniors + l.seniors, pwd: s.pwd + l.pwd }), { adults: 0, children: 0, seniors: 0, pwd: 0 });
  const idOk = !!r.id_verified_at;
  const formOk = selLines.length > 0 && selLines.every((l) => l.signed_form_at);
  const balOk = d.totals.outstanding <= 0 || !!exc?.reason;
  const readyOk = selLines.length > 0 && selLines.every((l) => l.ready);
  const needForm = settings.checkin_require_signed_form !== false;
  const gateOk = idOk && (formOk || !needForm) && balOk && readyOk;
  const openCount = [idOk, formOk || !needForm, balOk, readyOk].filter((x) => !x).length;

  const post = (url, body) => a.run(async () => { const res = await api.post(url, body); setD(res); return res; });

  return (
    <div className="stack">
      <ReservationSearch current={`Result: ${r.reference} | ${r.reservation_status} | ${d.lines.filter((l) => l.line_status !== 'Cancelled').length} rooms | Balance due ${peso(d.totals.outstanding)}`} />
      {done && <div className="okmsg">Checked in: {done}. Keys may be released for these rooms. <Link to={`/reservations/${id}`}>Open reservation</Link></div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2.2fr)' }}>
        <Panel num={2} title="Guest information (whole reservation)">
          <div className="stack" style={{ gap: 8 }}>
            <Field label="Primary Guest"><input readOnly value={d.guest.full_name} /></Field>
            <div className="grid g2">
              <Field label="Contact Number"><input readOnly value={d.guest.contact_no || ''} /></Field>
              <Field label="Rooms Booked"><input readOnly value={`${d.lines.filter((l) => l.line_status !== 'Cancelled').length} (${new Set(d.lines.map((l) => l.category)).size} categories)`} /></Field>
              <Field label="Check-in Date"><input readOnly value={fmtDate(r.check_in)} /></Field>
              <Field label="Check-out Date"><input readOnly value={fmtDate(r.check_out)} /></Field>
            </div>
            <div className="small muted">Occupant Categories (reservation total)</div>
            <div className="grid g4">
              {[['Adults', counts.adults], ['Children', counts.children], ['Senior', counts.seniors], ['PWD', counts.pwd]].map(([k, v]) => <Field key={k} label={k}><input readOnly className="num" value={v} /></Field>)}
            </div>
          </div>
        </Panel>

        <Panel num={3} title="Rooms in this reservation and housekeeping verification">
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th /><th>Category</th><th>Room</th><th className="right">Rate / night</th><th>Guests</th><th>Room status</th><th>HK confirmed</th><th>Readiness</th><th>Check-in</th></tr></thead>
              <tbody>
                {d.lines.filter((l) => l.line_status !== 'Cancelled').map((l) => {
                  const canPick = l.line_status === 'Active' && l.ready;
                  return (
                    <tr key={l.id} className={sel.includes(l.id) ? 'sel' : ''}>
                      <td><input type="checkbox" disabled={!canPick} checked={sel.includes(l.id)} onChange={() => toggle(l.id)} /></td>
                      <td>{l.category}</td><td><b>{l.room_no}</b></td><td className="num">{peso(l.rate_per_night)}</td><td>{guestsLabel(l)}</td>
                      <td><Badge>{l.hk_status}</Badge>{l.block_status !== 'None' && <> <Badge>{l.block_status}</Badge></>}</td>
                      <td>
                        {l.line_status !== 'Active' ? '-' : !l.hk_tick_required ? (l.room_ready ? <span className="small" style={{ color: 'var(--green)' }}>Clean (HK module)</span> : <span className="open">not yet</span>) : l.hk_confirmed_at
                          ? <label className="check"><input type="checkbox" checked onChange={() => post(`/reservations/${id}/lines/${l.id}/hk-confirm`, { confirmed: false })} /> {fmtTime(l.hk_confirmed_at)}</label>
                          : l.room_ready
                            ? <button className="btn sm outline" onClick={() => post(`/reservations/${id}/lines/${l.id}/hk-confirm`, {})} title="Tick after confirming readiness with Housekeeping">Confirm with HK</button>
                            : <span className="open">not yet</span>}
                      </td>
                      <td>{l.line_status !== 'Active' ? <Badge>{l.line_status}</Badge> : l.ready ? <Badge t="solid-green">READY</Badge> : <Badge t="amber">NOT READY</Badge>}</td>
                      <td className="small">{l.line_status === 'Checked In' ? <span style={{ color: 'var(--green)' }}>Checked in {fmtTime(l.checked_in_at)}</span> : sel.includes(l.id) ? <b style={{ color: 'var(--green)' }}>Checking in now</b> : !l.ready ? (
                        <div>
                          <span className="open">Waiting for Room{l.ready_why ? ` (${l.ready_why})` : ''}</span>
                          {l.arrived_at
                            ? <div className="small"><Badge t="amber">Check-in Pending</Badge> since {fmtTime(l.arrived_at)} <button className="linkbtn" onClick={() => post(`/reservations/${id}/lines/${l.id}/arrived`, { undo: true })}>undo</button></div>
                            : <div><button className="linkbtn" onClick={() => post(`/reservations/${id}/lines/${l.id}/arrived`, { note: 'Waiting in the restaurant waiting area' })}>Guest arrived - waiting</button></div>}
                        </div>) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn outline" onClick={() => setSel(pending.filter((l) => l.ready).map((l) => l.id))}>Select all ready rooms</button>
            {pending.length > 0 && (
              <select className="btn outline" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && nav(`/reservations/${id}/lines/${e.target.value}/transfer`)}>
                <option value="">Change Room…</option>
                {d.lines.filter((l) => ['Active', 'Checked In'].includes(l.line_status)).map((l) => <option key={l.id} value={l.id}>{l.room_no}</option>)}
              </select>
            )}
            <span className="small muted" style={{ flex: 1 }}>Rooms can be checked in together or one at a time. Each room needs its own readiness. Until the Housekeeping module is live, Front Office ticks the confirmation after contacting Housekeeping. <Proposed /></span>
          </div>
          <p className="open" style={{ marginTop: 8 }}>Selected: {sel.length} of {pending.length} pending rooms. The reservation stays Active until the last room is checked in (TO CONFIRM, RM-01).</p>
        </Panel>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2.2fr)' }}>
        <Panel num={4} title="Registration">
          <div className="stack" style={{ gap: 10 }}>
            <div className="grid g2">
              <Field label="Primary Guest ID Type"><select value={idf.id_type} onChange={(e) => setIdf({ ...idf, id_type: e.target.value })}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="ID Reference" hint={<Open id="OD-11">store?</Open>}><input value={idf.id_ref} onChange={(e) => setIdf({ ...idf, id_ref: e.target.value })} placeholder="optional" /></Field>
            </div>
            <Field label="Attach ID copy (restricted access)"><input type="file" accept="image/*,application/pdf" onChange={(e) => setIdf({ ...idf, file: e.target.files[0] || null })} /></Field>
            {r.id_attachment_id && <button className="linkbtn" onClick={async () => window.open(await attachmentUrl(r.id_attachment_id))}>View attached ID copy</button>}
            <label className="check"><input type="checkbox" checked={idf.verified} onChange={(e) => setIdf({ ...idf, verified: e.target.checked })} /> ID verified against the guest</label>
            <button className="btn outline" disabled={!idf.verified || a.busy} onClick={async () => post(`/reservations/${id}/id-verify`, { id_type: idf.id_type, id_ref: idf.id_ref, verified: true, file: idf.file ? await fileToPayload(idf.file) : null })}>
              {idOk ? `ID verified by ${r.id_verified_by} - update` : 'Save ID verification'}
            </button>
            <div className="hr" />
            <div className="row">
              <Link className="btn outline" to={`/reservations/${id}/registration`} target="_blank"><Icon name="print" size={16} />Print Registration Form</Link>
            </div>
            <div className="small muted">Signed copy covers room(s) <Open id="RM-03">per room or per guest: TO CONFIRM</Open></div>
            <div className="row">{pending.map((l) => (
              <label key={l.id} className="check small"><input type="checkbox" checked={formLines.includes(l.id)} onChange={() => setFormLines(formLines.includes(l.id) ? formLines.filter((x) => x !== l.id) : [...formLines, l.id])} />{l.room_no}</label>
            ))}</div>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFormFile(e.target.files[0] || null)} />
            <label className="check small"><input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} /> Signed paper form is on file (no scan)</label>
            <button className="btn outline" disabled={!formLines.length || (!formFile && !paper) || a.busy}
              onClick={async () => post(`/reservations/${id}/signed-form`, { line_ids: formLines, paper_on_file: paper, file: formFile ? await fileToPayload(formFile) : null })}>Attach Signed Copy</button>
            <div className="small open">{d.lines.filter((l) => l.line_status !== 'Cancelled').map((l) => `${l.room_no} ${l.signed_form_at ? 'signed copy attached' : 'not attached'}`).join('  |  ')}</div>
          </div>
        </Panel>

        <Panel num={5} title="Payment (whole reservation)">
          <div className="grid g2">
            <div className="stack" style={{ gap: 10 }}>
              <div className="grid g3">
                <Field label="Original"><input readOnly className="num" value={peso(d.totals.total)} /></Field>
                <Field label="Down Payment" hint={<span className="small muted">requested {peso(d.totals.downPaymentRequired)}</span>}><input readOnly className="num" value={peso(d.totals.paid)} title="Received so far" /></Field>
                <Field label="Outstanding"><input readOnly className="num watch" value={peso(d.totals.outstanding)} /></Field>
              </div>
              {d.payments.length > 0 && (
                <table className="tbl"><thead><tr><th>Payment</th><th>Method</th><th className="right">Amount</th><th>Reference</th></tr></thead>
                  <tbody>{d.payments.flatMap((p) => p.tenders.map((t, i) => <tr key={`${p.id}-${i}`}><td><Link to={`/receipt/${p.id}`}>{p.payment_no}</Link></td><td>{t.method}</td><td className="num">{peso(t.amount)}</td><td>{t.reference || '-'}</td></tr>))}</tbody></table>
              )}
              <p className="open">Allocation of the down payment to each room: TO CONFIRM (RM-02). Balance is kept at reservation level.</p>
              {paid && <div className="okmsg">{paid.payment_no} recorded. <Link to={`/receipt/${paid.id}`}>Print {paid.receipt?.doc_type} {paid.receipt?.receipt_no}</Link></div>}
            </div>
            <div>
              {d.totals.outstanding > 0
                ? <TenderEntry due={d.totals.outstanding} busy={a.busy} onSubmit={(tenders) => a.run(async () => { const res = await api.post(`/reservations/${id}/payments`, { tenders }); setD(res); setPaid(res.payment); return res; })} />
                : <div className="okmsg">Balance fully collected.</div>}
            </div>
          </div>
        </Panel>
      </div>

      <ErrorBox error={a.error} />
      <div className="actionbar">
        <b className="small">Confirm Check-in unlocks when each selected room meets all four:</b> <Proposed />
        <div className="checklist">
          <Check ok={idOk}>ID verified</Check>
          {needForm && <Check ok={formOk}>Signed form attached ({selLines.filter((l) => l.signed_form_at).length} of {selLines.length})</Check>}
          <Check ok={balOk}>Balance collected or approved exception</Check>
          <Check ok={readyOk}>Room ready confirmed</Check>
        </div>
        <span className="sp" />
        {d.totals.outstanding > 0 && !exc && <button className="btn sm outline" onClick={() => setExc({ reason: '', approval: {}, editing: true })}>Balance exception…</button>}
        {openCount > 0 && <span className="open">{openCount} open</span>}
        <button className={`btn gold ${gateOk ? '' : 'locked'}`} disabled={!gateOk || a.busy}
          onClick={() => a.run(async () => {
            if (!(await askConfirm({ title: 'Confirm Check-in', confirmLabel: 'Confirm Check-in', message: `Check in ${selLines.map((l) => l.room_no).join(', ')} for ${d.guest.full_name}? The room(s) become Occupied and keys may be released.` }))) return;
            const res = await api.post(`/reservations/${id}/checkin`, { line_ids: sel, exception: exc?.reason ? { reason: exc.reason, approval: exc.approval } : undefined });
            setDone(selLines.map((l) => l.room_no).join(', ')); setSel([]); setD(res); setExc(null);
          })}>Confirm Check-in ({sel.length} room{sel.length === 1 ? '' : 's'})</button>
      </div>

      {exc?.editing && (
        <Modal title="Check in with an outstanding balance" onClose={() => setExc(null)} footer={<>
          <button className="btn outline" onClick={() => setExc(null)}>Back</button>
          <button className="btn" disabled={!exc.reason} onClick={() => setExc({ ...exc, editing: false })}>Use this exception</button>
        </>}>
          <div className="note">Front Office normally collects the remaining balance at check-in. An exception needs an approving user and a reason. Outstanding: <b>{peso(d.totals.outstanding)}</b></div>
          <Field label="Reason"><textarea value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} /></Field>
          <ApprovalFields value={exc.approval} onChange={(v) => setExc({ ...exc, approval: v })} />
        </Modal>
      )}
    </div>
  );
}
