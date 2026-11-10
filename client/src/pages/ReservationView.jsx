// Reservation detail: room lines, folio, payments, history, and every action on the booking.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ApprovalFields, AttachmentLink, Badge, ErrorBox, Field, FileInput, Modal, Panel, ReasonModal, TenderEntry, useAction, useLoad, Open } from '../components/ui.jsx';
import { fileToPayload } from '../api.js';
import { fmtDate, fmtDateTime, guestsLabel, peso, pesoSigned, toCents } from '../util.js';

export function FolioTable({ d, onVoid }) {
  const n = d.totals.nights;
  const rows = [];
  for (const l of d.lines.filter((x) => x.line_status !== 'Cancelled'))
    rows.push({ k: `r${l.id}`, when: d.reservation.check_in, room: l.room_no, desc: `Room ${l.category} ${n} night(s) x ${peso(l.rate_per_night)}`, amount: l.rate_per_night * n });
  for (const c of d.charges) rows.push({ k: `c${c.id}`, when: c.created_at, room: c.room_no, desc: c.description, src: c.kind, amount: c.amount, by: c.created_by, charge: c, att: c.attachment_id });
  for (const x of d.dept) rows.push({ k: `d${x.id}`, when: x.created_at, room: x.room_no, desc: `${x.department}: ${x.items.map((i) => `${i.name} x${i.qty}`).join(', ')}`, src: x.source_txn_id, amount: x.amount, by: x.employee, att: x.attachment_id });
  for (const x of d.discounts) rows.push({ k: `x${x.id}`, when: x.created_at, desc: `Less: ${x.category} discount (${x.reason})`, src: `approved ${x.approver}`, amount: -x.amount });
  const voided = new Set(d.charges.filter((c) => c.reverses_id).map((c) => c.reverses_id));
  return (
    <table className="tbl">
      <thead><tr><th>Date</th><th>Room</th><th>Description</th><th>Source ID</th><th>By</th><th className="right">Amount</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.k} className={r.charge && voided.has(r.charge.id) ? 'dim' : ''}>
            <td className="nowrap">{r.when?.length > 10 ? fmtDateTime(r.when) : fmtDate(r.when)}</td><td>{r.room || '-'}</td><td>{r.desc}</td>
            <td className="mono small">{r.src || '-'}{r.att && <div><AttachmentLink id={r.att}>{r.charge ? 'evidence' : 'charge bill'}</AttachmentLink></div>}</td><td>{r.by || '-'}</td><td className="num">{pesoSigned(r.amount)}</td>
            <td>{onVoid && r.charge && !r.charge.reverses_id && r.charge.amount > 0 && r.charge.kind !== 'upgrade' && !voided.has(r.charge.id) && <button className="linkbtn red" onClick={() => onVoid(r.charge)}>void</button>}</td>
          </tr>
        ))}
        <tr className="total"><td colSpan={5}>Total charges</td><td className="num">{peso(d.totals.total)}</td><td /></tr>
      </tbody>
    </table>
  );
}

export function PaymentsTable({ payments }) {
  return (
    <table className="tbl">
      <thead><tr><th>Payment</th><th>Date</th><th>Purpose</th><th>Tenders</th><th>Cashier</th><th>Receipt</th><th className="right">Amount</th></tr></thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id}><td className="mono">{p.payment_no}</td><td className="nowrap">{fmtDateTime(p.paid_at)}</td><td>{p.purpose}</td>
            <td className="small">{p.tenders.map((t) => `${t.method} ${peso(t.amount)}${t.reference ? ` (${t.reference})` : ''}`).join(' + ')}</td><td>{p.cashier}</td>
            <td>{p.receipt_no ? <Link to={`/receipt/${p.id}`}>{p.receipt_no}</Link> : <span className="muted small">{p.kind}</span>}</td>
            <td className="num">{pesoSigned(p.total)}</td></tr>
        ))}
        {!payments.length && <tr><td colSpan={7} className="muted">No payments yet.</td></tr>}
      </tbody>
    </table>
  );
}

export default function ReservationView() {
  const { id } = useParams();
  const { can, settings } = useAuth();
  const [d, , err, setD] = useLoad(`/reservations/${id}`);
  const [modal, setModal] = useState(null);
  const a = useAction();
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const r = d.reservation;
  const active = r.reservation_status === 'Active / Booked';
  const open = ['Active / Booked', 'Checked In'].includes(r.reservation_status);
  const anyIn = d.lines.some((l) => l.line_status === 'Checked In');
  const anyPending = d.lines.some((l) => l.line_status === 'Active');
  const FD = can('frontdesk');

  return (
    <div className="stack">
      <div className="banner">
        <div><div className="muted small">Reservation</div><div className="big">{r.reference}</div></div>
        <div><div className="muted small">Primary guest</div><div className="big">{d.guest.full_name}</div><div className="muted small">{d.guest.contact_no}</div></div>
        <div><div className="muted small">Stay</div><div>{fmtDate(r.check_in)} to {fmtDate(r.check_out)} ({d.totals.nights} night{d.totals.nights === 1 ? '' : 's'})</div><div className="muted small">Source: {r.source}</div></div>
        <span style={{ flex: 1 }} />
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div className="row"><span className="muted small">Reservation</span><Badge>{r.reservation_status}</Badge></div>
          <div className="row"><span className="muted small">Payment</span><Badge>{r.payment_status}</Badge></div>
        </div>
        <div><div className="muted small">Outstanding</div><div className="big gold">{peso(d.totals.outstanding)}</div></div>
      </div>

      <div className="row noprint">
        {FD && anyPending && open && <Link className="btn gold" to={`/reservations/${id}/checkin`}>Check-in</Link>}
        {FD && anyIn && <Link className="btn" to={`/reservations/${id}/checkout`}>Check-out</Link>}
        {can('reservation.edit') && active && <Link className="btn outline" to={`/reservations/${id}/edit`}>Amend reservation</Link>}
        {FD && open && d.totals.outstanding > 0 && <button className="btn outline" onClick={() => setModal('pay')}>Record payment</button>}
        {FD && open && <button className="btn outline" onClick={() => setModal('charge')}>Add charge</button>}
        {FD && open && <button className="btn outline" onClick={() => setModal('discount')}>Add approved discount</button>}
        {FD && <Link className="btn outline" to={`/reservations/${id}/registration`}>Print registration form</Link>}
        <span style={{ flex: 1 }} />
        {can('reservation.edit') && active && !anyIn && <button className="btn danger" onClick={() => setModal('cancel')}>Cancel Reservation</button>}
        {FD && r.reservation_status === 'Cancelled' && !r.refund_decision && <button className="btn" onClick={() => setModal('refund')}>Refund decision</button>}
      </div>
      <ErrorBox error={a.error} />

      {r.reservation_status === 'Cancelled' && (
        <div className="note red">Cancelled {fmtDateTime(r.cancelled_at)} by {r.cancelled_by}: <b>{r.cancel_reason}</b>. History and payments are kept.
          {r.refund_decision ? <> Refund decision: <b>{r.refund_decision}</b> ({r.refund_note}, approved by {r.refund_approver}).</> : d.totals.paid > 0 && <> Deposit of {peso(d.totals.paid)} awaits a refund / forfeit decision <Open id="OD-03" />.</>}
        </div>
      )}
      {!!r.is_opening_record && <div className="note teal">Cutover opening record entered by hand from WinCloud. {r.remarks}</div>}

      <div className="grid g3">
        <Panel title="Rooms" className="span2">
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>Room</th><th>Category</th><th className="right">Rate / night</th><th>Guests</th><th>Line status</th><th>Occupancy</th><th>Room HK</th><th /></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className={l.line_status === 'Cancelled' ? 'dim' : ''}>
                    <td><b>{l.room_no}</b></td><td>{l.category}</td>
                    <td className="num">{peso(l.rate_per_night)}{l.effective_rate !== l.rate_per_night && <div className="small muted">upgraded to {peso(l.effective_rate)}</div>}</td>
                    <td>{guestsLabel(l)}</td><td><Badge>{l.line_status}</Badge></td><td>{l.line_status === 'Cancelled' ? '-' : <Badge>{l.occupancy_status}</Badge>}{l.stay_status && <div><Badge t="amber">{l.stay_status}</Badge></div>}</td>
                    <td>{l.hk_status && <Badge>{l.hk_status}</Badge>} {l.block_status && l.block_status !== 'None' && <Badge>{l.block_status}</Badge>}</td>
                    <td>{FD && ['Active', 'Checked In'].includes(l.line_status) && <Link className="btn sm outline" to={`/reservations/${id}/lines/${l.id}/transfer`}>Change Room</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.transfers.length > 0 && (<>
            <h3 style={{ marginTop: 14 }}>Room transfers</h3>
            <table className="tbl"><thead><tr><th>When</th><th>From</th><th>To</th><th>Reason</th><th>Treatment</th><th className="right">Upgrade value</th><th>Approved / paid</th></tr></thead>
              <tbody>{d.transfers.map((t) => (
                <tr key={t.id}><td className="nowrap">{fmtDateTime(t.created_at)}</td><td>{t.from_room}</td><td>{t.to_room}</td><td>{t.reason_type === 'fault' ? 'Fault' : 'Guest'}: {t.reason}</td>
                  <td>{t.treatment}</td><td className="num">{peso(t.upgrade_value)}</td><td>{t.waived_by ? `Waived by ${t.waived_by}` : t.payment_id ? 'Paid' : '-'}</td></tr>
              ))}</tbody></table>
          </>)}
        </Panel>
        <Panel title="Balance">
          <div className="kv">
            <span>Room charges</span><span>{peso(d.totals.room)}</span>
            <span>Other folio charges</span><span>{peso(d.totals.charges)}</span>
            <span>Department charges</span><span>{peso(d.totals.dept)}</span>
            <span>Discounts</span><span>{pesoSigned(-d.totals.discounts)}</span>
            <b>Total</b><b>{peso(d.totals.total)}</b>
            <span>Down payment requested ({r.down_payment_pct}%)</span><span>{peso(d.totals.downPaymentRequired)}</span>
            <span>Down payment due</span><span>{fmtDate(r.down_payment_due)}</span>
            <span>Received</span><span>{peso(d.totals.paid)}</span>
            <b>Outstanding</b><b style={{ color: 'var(--navy)' }}>{pesoSigned(d.totals.outstanding)}</b>
          </div>
          <p className="small muted">Requested, received and outstanding amounts are kept apart (FO-RSV-04). One master folio per reservation; each charge keeps its room <Open id="RM-05" />.</p>
        </Panel>
      </div>

      <Panel title="Folio">
        <div className="tablewrap"><FolioTable d={d} onVoid={FD && open ? (c) => setModal({ void: c }) : null} /></div>
      </Panel>
      <Panel title="Payments">
        <div className="tablewrap"><PaymentsTable payments={d.payments} /></div>
      </Panel>
      <Panel title="History (audit trail)">
        <table className="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{d.history.map((h) => (
            <tr key={h.id}><td className="nowrap">{fmtDateTime(h.at)}</td><td>{h.username}</td><td className="mono small">{h.action}</td>
              <td className="small">{h.reason && <div><b>Reason:</b> {h.reason}</div>}{h.approver && <div><b>Approved by:</b> {h.approver}</div>}{h.to_value && <div className="mono" style={{ wordBreak: 'break-all' }}>{h.to_value.slice(0, 300)}</div>}</td></tr>
          ))}</tbody></table>
      </Panel>

      {modal === 'pay' && (
        <Modal title={`Record payment: ${r.reference}`} onClose={() => setModal(null)}>
          <div className="kv"><span>Outstanding</span><b>{peso(d.totals.outstanding)}</b>{active && !anyIn && <><span>Down payment still requested</span><span>{peso(d.totals.downPaymentOutstanding)}</span></>}</div>
          <TenderEntry due={d.totals.outstanding} busy={a.busy} onSubmit={(tenders) => a.run(async () => {
            const res = await api.post(`/reservations/${id}/payments`, { tenders });
            setD(res); setModal({ paid: res.payment });
            return res;
          })} />
          <ErrorBox error={a.error} />
        </Modal>
      )}
      {modal === 'charge' && <ChargeModal d={d} onClose={() => setModal(null)} onDone={setD} />}
      {modal === 'discount' && <DiscountModal d={d} settings={settings} onClose={() => setModal(null)} onDone={setD} />}
      {modal === 'cancel' && (
        <ReasonModal title="Cancel Reservation" label="Cancellation reason (required)" danger submitLabel="Cancel Reservation" onClose={() => setModal(null)}
          onSubmit={async ({ reason }) => setD(await api.post(`/reservations/${id}/cancel`, { reason }))}>
          <div className="note">This is not a delete. The room(s) are released, and the reservation, payments and amendment history are kept. A refund is a separate, approved decision.</div>
        </ReasonModal>
      )}
      {modal === 'refund' && <RefundModal d={d} settings={settings} onClose={() => setModal(null)} onDone={setD} />}
      {modal?.void && (
        <ReasonModal title={`Void charge: ${modal.void.description}`} needsApproval danger submitLabel="Void (post reversal)" onClose={() => setModal(null)}
          onSubmit={async ({ reason, approval }) => setD(await api.post(`/reservations/${id}/charges/${modal.void.id}/void`, { reason, approval }))}>
          <div className="note">A correction is a new reversing line of {peso(-modal.void.amount)}. The original stays on record.</div>
        </ReasonModal>
      )}
      {modal?.paid && (
        <Modal title="Payment recorded" onClose={() => setModal(null)} footer={<><button className="btn outline" onClick={() => setModal(null)}>Close</button><Link className="btn gold" to={`/receipt/${modal.paid.id}`}>Print receipt</Link></>}>
          <div className="okmsg">{modal.paid.payment_no} for {peso(modal.paid.total)} recorded. {modal.paid.receipt?.doc_type} {modal.paid.receipt?.receipt_no} issued.</div>
        </Modal>
      )}
    </div>
  );
}

export function ChargeModal({ d, onClose, onDone }) {
  const [f, setF] = useState({ kind: 'extra', description: '', amount: '', reason: '', line_id: '' });
  const [file, setFile] = useState(null);
  const a = useAction();
  return (
    <Modal title="Add folio charge" onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { onDone(await api.post(`/reservations/${d.reservation.id}/charges`, { ...f, amount: toCents(f.amount), line_id: f.line_id || null, file: file ? await fileToPayload(file) : null })); onClose(); })}>Post charge</button>
    </>}>
      <div className="grid g2">
        <Field label="Type"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="extra">Extra service</option><option value="inspection">Inspection finding (amenities / minibar)</option><option value="damage">Damage / loss</option><option value="adjustment">Adjustment</option>
        </select></Field>
        <Field label="Room"><select value={f.line_id} onChange={(e) => setF({ ...f, line_id: e.target.value })}>
          <option value="">Whole reservation</option>{d.lines.filter((l) => l.line_status !== 'Cancelled').map((l) => <option key={l.id} value={l.id}>{l.room_no}</option>)}
        </select></Field>
      </div>
      <Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Amount"><input className="num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Source, reason and evidence (required)"><textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. HK inspection 11:20 by [name]: broken glass" /></Field>
      <FileInput label="Evidence (photo / PDF)" onChange={setFile} />
      <ErrorBox error={a.error} />
    </Modal>
  );
}

function DiscountModal({ d, settings, onClose, onDone }) {
  const [f, setF] = useState({ category: settings.discount_categories?.[0] || '', amount: '', basis: '', vat_treatment: '', reason: '', id_verified: false });
  const [approval, setApproval] = useState({});
  const a = useAction();
  return (
    <Modal title="Add approved discount" onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { onDone(await api.post(`/reservations/${d.reservation.id}/discounts`, { ...f, amount: toCents(f.amount), approval })); onClose(); })}>Add discount</button>
    </>}>
      <div className="note">Senior / PWD: ID check is required and the amount must follow the approved formula and VAT treatment, which is not built yet <Open id="OD-09, 10, 12" />. Enter the computed amount and its basis. The original sale stays as a separate line.</div>
      <div className="grid g2">
        <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(settings.discount_categories || []).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Discount amount"><input className="num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Basis (eligible items / computation)"><input value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} /></Field>
        <Field label="VAT treatment"><input value={f.vat_treatment} onChange={(e) => setF({ ...f, vat_treatment: e.target.value })} /></Field>
      </div>
      <Field label="Reason / ID reference (required)"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={f.id_verified} onChange={(e) => setF({ ...f, id_verified: e.target.checked })} /> Senior Citizen / PWD ID checked against the guest</label>
      <ApprovalFields value={approval} onChange={setApproval} />
      <ErrorBox error={a.error} />
    </Modal>
  );
}

function RefundModal({ d, settings, onClose, onDone }) {
  const [decision, setDecision] = useState('No Refund');
  const [amount, setAmount] = useState((d.totals.paid / 100).toFixed(2));
  const [method, setMethod] = useState(settings.payment_methods?.[0]);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState({});
  const a = useAction();
  return (
    <Modal title="Refund / forfeit decision" onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy || !reason} onClick={() => a.run(async () => { onDone(await api.post(`/reservations/${d.reservation.id}/refund-decision`, { decision, amount: toCents(amount), method, reference, reason, approval })); onClose(); })}>Record decision</button>
    </>}>
      <div className="note">Refund, forfeiture or transfer of a deposit depends on the reason and management approval <Open id="OD-03" />. Received: <b>{peso(d.totals.paid)}</b>.</div>
      <div className="seg">{['No Refund', 'Refund Completed'].map((x) => <button key={x} type="button" className={decision === x ? 'on' : ''} onClick={() => setDecision(x)}>{x === 'No Refund' ? 'Forfeit (no refund)' : 'Refund paid out'}</button>)}</div>
      {decision === 'Refund Completed' && (
        <div className="grid g3">
          <Field label="Refund amount"><input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Paid out by"><select value={method} onChange={(e) => setMethod(e.target.value)}>{settings.payment_methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Reason (required)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ApprovalFields value={approval} onChange={setApproval} />
      <ErrorBox error={a.error} />
    </Modal>
  );
}
