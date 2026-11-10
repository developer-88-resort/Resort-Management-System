// Check-out (Part 1, s5.2): review all department charges, inspection, collect final balance, close folio. Room becomes Dirty.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { askConfirm } from '../components/notify.jsx';
import { api } from '../api.js';
import { ApprovalFields, Check, ErrorBox, Field, Modal, Panel, TenderEntry, useAction, useLoad } from '../components/ui.jsx';
import { fmtDate, fmtTime, peso } from '../util.js';
import { ChargeModal, FolioTable, PaymentsTable } from './ReservationView.jsx';

export default function CheckOut() {
  const { id } = useParams();
  const [d, , err, setD] = useLoad(`/reservations/${id}`);
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(null);
  const [exc, setExc] = useState(null);
  const [paid, setPaid] = useState(null);
  const a = useAction();
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const r = d.reservation;
  const inHouse = d.lines.filter((l) => l.line_status === 'Checked In');
  const selected = sel ?? inHouse.map((l) => l.id);
  const balOk = d.totals.outstanding <= 0 || !!exc?.reason;
  const can = selected.length > 0 && balOk;
  return (
    <div className="stack">
      <div className="banner">
        <div><div className="muted small">Check-out</div><div className="big">{r.reference} · {d.guest.full_name}</div><div className="muted small">{fmtDate(r.check_in)} to {fmtDate(r.check_out)}</div></div>
        <span style={{ flex: 1 }} />
        <div><div className="muted small">Outstanding</div><div className="big gold">{peso(d.totals.outstanding)}</div></div>
      </div>
      {r.reservation_status === 'Checked Out' && <div className="okmsg">All rooms are checked out. Folio is {r.payment_status}. Rooms are now Dirty for Housekeeping. <Link to={`/reservations/${id}`}>Back to reservation</Link></div>}

      <div className="grid g3">
        <Panel num={1} title="Rooms to check out">
          {inHouse.map((l) => (
            <label key={l.id} className="check" style={{ display: 'flex', marginBottom: 6 }}>
              <input type="checkbox" checked={selected.includes(l.id)} onChange={() => setSel(selected.includes(l.id) ? selected.filter((x) => x !== l.id) : [...selected, l.id])} />
              <b>{l.room_no}</b> {l.category} <span className="muted small">in since {fmtTime(l.checked_in_at)}</span>
            </label>
          ))}
          {!inHouse.length && <p className="muted">No room is checked in.</p>}
        </Panel>
        <Panel num={2} title="Housekeeping inspection" className="span2">
          <p className="small muted">Housekeeping inspects room, amenities, minibar, damage and loss, and reports any extra charge. The charge needs a source, reason and evidence.</p>
          <Field label="Inspection note (linked to the stay)"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Inspected by [name] 11:20 - all amenities complete" /></Field>
          <div className="row" style={{ marginTop: 8 }}><button className="btn outline" onClick={() => setModal('charge')}>+ Add inspection / extra charge</button></div>
        </Panel>
      </div>

      <Panel num={3} title="Itemized charges from all departments">
        <div className="tablewrap"><FolioTable d={d} /></div>
      </Panel>
      <div className="grid g2">
        <Panel num={4} title="Collect final balance">
          <div className="kv" style={{ marginBottom: 10 }}><span>Total</span><span>{peso(d.totals.total)}</span><span>Paid</span><span>{peso(d.totals.paid)}</span><b>Outstanding</b><b>{peso(d.totals.outstanding)}</b></div>
          {d.totals.outstanding > 0
            ? <TenderEntry due={d.totals.outstanding} busy={a.busy} onSubmit={(tenders) => a.run(async () => { const res = await api.post(`/reservations/${id}/payments`, { tenders }); setD(res); setPaid(res.payment); return res; })} />
            : <div className="okmsg">Balance settled.</div>}
          {paid && <div className="okmsg" style={{ marginTop: 8 }}>{paid.payment_no} recorded. <Link to={`/receipt/${paid.id}`}>Print official receipt {paid.receipt?.receipt_no}</Link></div>}
        </Panel>
        <Panel title="Payments on this stay"><div className="tablewrap"><PaymentsTable payments={d.payments} /></div></Panel>
      </div>
      <ErrorBox error={a.error} />
      <div className="actionbar">
        <div className="checklist"><Check ok={selected.length > 0}>Room(s) selected</Check><Check ok={balOk}>Balance settled or approved exception</Check></div>
        <span className="sp" />
        {d.totals.outstanding > 0 && <button className="btn sm outline" onClick={() => setExc({ reason: '', approval: {}, editing: true })}>Balance exception…</button>}
        <button className={`btn gold ${can ? '' : 'locked'}`} disabled={!can || a.busy} onClick={() => a.run(async () => {
          if (!(await askConfirm({ title: 'Confirm Check-out', confirmLabel: 'Confirm Check-out', message: `Check out ${inHouse.filter((l) => selected.includes(l.id)).map((l) => l.room_no).join(', ')}? The room(s) will be set to Dirty for Housekeeping.` }))) return;
          const res = await api.post(`/reservations/${id}/checkout`, { line_ids: selected, inspection_note: note, exception: exc?.reason ? { reason: exc.reason, approval: exc.approval } : undefined });
          setD(res); setSel(null); setExc(null);
        })}>Confirm Check-out ({selected.length})</button>
      </div>
      {modal === 'charge' && <ChargeModal d={d} onClose={() => setModal(null)} onDone={setD} />}
      {exc?.editing && (
        <Modal title="Check out with an outstanding balance" onClose={() => setExc(null)} footer={<><button className="btn outline" onClick={() => setExc(null)}>Back</button><button className="btn" disabled={!exc.reason} onClick={() => setExc({ ...exc, editing: false })}>Use this exception</button></>}>
          <div className="note">The folio closes only when settled, or when an approved exception exists. The balance stays on record as Balance Due.</div>
          <Field label="Reason"><textarea value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} /></Field>
          <ApprovalFields value={exc.approval} onChange={(v) => setExc({ ...exc, approval: v })} />
        </Modal>
      )}
    </div>
  );
}
