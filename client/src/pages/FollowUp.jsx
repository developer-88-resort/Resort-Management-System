// Down payment follow-up (Part 1 Fig. 3): a booking with no down payment "Stays Active / Unpaid - room remains blocked,
// follow up with guest". The automatic release rule is TO CONFIRM (OD-02), so nothing is released here.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, Modal, Open, TenderEntry, useAction, useLoad } from '../components/ui.jsx';
import { fmtDate, fmtDateTime, peso } from '../util.js';

const CHANNELS = ['Phone call', 'Facebook / Messenger', 'SMS', 'Email', 'Other'];

export default function FollowUp() {
  const { can } = useAuth();
  const [d, reload, err] = useLoad('/reservations?view=followup');
  const [log, setLog] = useState(null);
  const [pay, setPay] = useState(null);
  const rows = d?.reservations || [];
  return (
    <div className="stack">
      <div className="pagehead"><h1>Down Payment Follow-up</h1><span className="sp" />
        <span className="small muted">Active bookings still short of the requested down payment. The room stays blocked. Release rule <Open id="OD-02" />.</span></div>
      <ErrorBox error={err} />
      <div className="grid g4">
        <div className="stat"><div className="v">{rows.length}</div><div className="l">Bookings to follow up</div></div>
        <div className="stat"><div className="v" style={{ color: 'var(--red)' }}>{rows.filter((r) => r.overdue).length}</div><div className="l">Past the due date</div></div>
        <div className="stat"><div className="v">{peso(rows.reduce((s, r) => s + r.totals.downPaymentOutstanding, 0))}</div><div className="l">Down payment still requested</div></div>
      </div>
      <div className="panel tablewrap">
        <table className="tbl">
          <thead><tr><th>Reservation</th><th>Guest</th><th>Contact</th><th>Source</th><th>Check-in</th><th>Due</th><th className="right">Requested</th><th className="right">Received</th><th className="right">Still due</th><th>Last follow-up</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.overdue ? 'sel' : ''}>
              <td><Link to={`/reservations/${r.id}`}>{r.reference}</Link></td><td>{r.full_name}</td><td>{r.contact_no}</td><td className="small">{r.source}</td>
              <td className="nowrap">{fmtDate(r.check_in)}</td>
              <td className="nowrap">{fmtDate(r.down_payment_due)} {r.overdue && <Badge t="red">Overdue</Badge>}</td>
              <td className="num">{peso(r.totals.downPaymentRequired)}</td><td className="num">{peso(r.totals.paid)}</td><td className="num"><b>{peso(r.totals.downPaymentOutstanding)}</b></td>
              <td className="small">{r.last_follow_up ? <>{fmtDateTime(r.last_follow_up.at)} {r.last_follow_up.username}<div>{r.last_follow_up.reason}</div></> : <span className="muted">none</span>}</td>
              <td className="nowrap">
                <button className="btn sm outline" onClick={() => setLog(r)}>Log follow-up</button>{' '}
                {can('frontdesk') && <button className="btn sm" onClick={() => setPay(r)}>Record payment</button>}
              </td>
            </tr>
          ))}{d && !rows.length && <tr><td colSpan={11} className="muted">Nothing to follow up.</td></tr>}</tbody>
        </table>
      </div>
      {log && <LogModal r={log} onClose={() => setLog(null)} onDone={reload} />}
      {pay && <PayModal r={pay} onClose={() => setPay(null)} onDone={reload} />}
    </div>
  );
}

function LogModal({ r, onClose, onDone }) {
  const [f, setF] = useState({ channel: CHANNELS[0], note: '', promised_date: '' });
  const a = useAction();
  return (
    <Modal title={`Follow-up: ${r.reference} ${r.full_name}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={!f.note || a.busy} onClick={() => a.run(async () => { await api.post(`/reservations/${r.id}/follow-up`, f); await onDone(); onClose(); })}>Save</button></>}>
      <div className="grid g2">
        <Field label="Channel"><select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Guest promised to pay on"><input type="date" value={f.promised_date} onChange={(e) => setF({ ...f, promised_date: e.target.value })} /></Field>
      </div>
      <Field label="Note"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Sent reminder on Messenger; guest will send GCash tomorrow" /></Field>
      <ErrorBox error={a.error} />
    </Modal>
  );
}

function PayModal({ r, onClose, onDone }) {
  const a = useAction();
  const [paid, setPaid] = useState(null);
  return (
    <Modal title={`Down payment: ${r.reference}`} onClose={onClose}>
      <div className="kv"><span>Down payment still requested</span><b>{peso(r.totals.downPaymentOutstanding)}</b><span>Full outstanding</span><span>{peso(r.totals.outstanding)}</span></div>
      {paid ? <div className="okmsg">{paid.payment_no} recorded. <Link to={`/receipt/${paid.id}`}>Print receipt {paid.receipt?.receipt_no}</Link></div>
        : <TenderEntry due={r.totals.outstanding} busy={a.busy} onSubmit={(tenders) => a.run(async () => { const res = await api.post(`/reservations/${r.id}/payments`, { tenders }); setPaid(res.payment); await onDone(); return res; })} />}
      <ErrorBox error={a.error} />
    </Modal>
  );
}
