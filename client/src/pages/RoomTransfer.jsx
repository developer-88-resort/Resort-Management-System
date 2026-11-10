// Room transfer (Part 2, Figs. 2-3). The reason decides who pays: fault = free upgrade (approval), guest = paid upgrade.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { askConfirm } from '../components/notify.jsx';
import { api } from '../api.js';
import { Badge, ErrorBox, Field, Open, Panel, Proposed, TenderEntry, useAction, useLoad } from '../components/ui.jsx';
import { fmtDate, peso } from '../util.js';

export default function RoomTransfer() {
  const { id, lineId } = useParams();
  const nav = useNavigate();
  const [res] = useLoad(`/reservations/${id}`);
  const [o, reloadOptions, err] = useLoad(`/reservations/${id}/lines/${lineId}/transfer-options`);
  const [type, setType] = useState('fault');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reportDefect, setReportDefect] = useState(true);
  const [to, setTo] = useState(null);
  const [appr, setAppr] = useState(null); // approval request (Part 2 Fig. 2 panel 5)
  const [approverReq, setApproverReq] = useState('');
  const [approvers] = useLoad('/approvals/approvers');
  const a = useAction();
  // Any change of room or reason makes an earlier approval invalid.
  useEffect(() => { setAppr(null); }, [to, type]);
  // While PENDING, check for the supervisor's decision every few seconds.
  useEffect(() => {
    if (appr?.status !== 'Pending') return undefined;
    const t = setInterval(async () => {
      try { setAppr((await api.get(`/approvals/${appr.id}`)).approval); } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [appr?.id, appr?.status]);
  if (err) return <ErrorBox error={err} />;
  if (!o || !res) return <p>Loading…</p>;
  const reasons = o.reasons[type] || [];
  const target = o.rooms.find((r) => r.id === to);
  const diff = target ? target.rate_per_night - o.current_rate : 0;
  const value = Math.max(diff, 0) * o.window.nights;
  const isPaid = type === 'guest' && diff > 0;
  const isWaiver = type === 'fault' && diff > 0;
  const lower = diff < 0;
  const approved = !isWaiver || appr?.status === 'Approved';
  const ready = target && reason && approved;

  const submit = (tenders) => a.run(async () => {
    if (!(await askConfirm({ title: 'Confirm Transfer', confirmLabel: 'Confirm Transfer', message: `Move ${res.guest.full_name} from ${o.line.room_no} to ${target.room_no}? ${isPaid ? `The ${peso(value)} difference will be billed and paid now.` : isWaiver ? `The ${peso(value)} difference is waived.` : 'No price change.'}` }))) return false;
    await api.post(`/reservations/${id}/lines/${lineId}/transfer`, {
      to_room_id: to, reason_type: type, reason, remarks, report_defect: reportDefect, approval_id: isWaiver ? appr?.id : undefined, tenders,
    });
    nav(`/reservations/${id}`);
    return true;
  });

  return (
    <div className="stack">
      <div className="banner">
        <div><div className="big">{res.guest.full_name} &nbsp;|&nbsp; {res.reservation.reference} &nbsp;|&nbsp; {fmtDate(res.reservation.check_in)} to {fmtDate(res.reservation.check_out)}</div>
          <div className="muted small">Current room {o.line.room_no} ({o.line.category}), {peso(o.current_rate)} per night &nbsp; Stage: {o.stage}</div></div>
        <span style={{ flex: 1 }} />
        {target && <span className={`badge ${isPaid ? 'navy' : 'amber'}`} style={{ fontSize: 14, padding: '6px 16px' }}>
          {isPaid ? 'PAID UPGRADE (guest request)' : isWaiver ? 'FREE UPGRADE (fault on resort side)' : lower ? 'LOWER-RATE ROOM' : 'SAME RATE: no charge'}</span>}
      </div>
      <div className="grid g3">
        <Panel num={1} title="Transfer reason">
          <div className="stack" style={{ gap: 10 }}>
            <div className="seg">
              <button type="button" className={type === 'fault' ? 'on' : ''} onClick={() => { setType('fault'); setReason(''); }}>Fault on resort side</button>
              <button type="button" className={type === 'guest' ? 'on' : ''} onClick={() => { setType('guest'); setReason(''); }}>Guest request</button>
            </div>
            <Field label="Reason" hint={<Proposed>list PROPOSED (RT-05)</Proposed>}>
              <select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose…</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field label="Remarks"><input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={type === 'fault' ? 'Reported 14:10, checked by [name]' : 'Guest will pay the difference'} /></Field>
            {type === 'fault'
              ? <label className="check"><input type="checkbox" checked={reportDefect} onChange={(e) => setReportDefect(e.target.checked)} /> Report defect and block {o.line.room_no}</label>
              : <span className="small muted">{o.line.room_no} goes to Dirty if it was used, else it stays Clean.</span>}
          </div>
        </Panel>
        <Panel num={2} title="New room (available for the stay dates)">
          <div className="tablewrap" style={{ maxHeight: 330, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Room</th><th>Category</th><th className="right">Rate / night</th><th>Status</th></tr></thead>
              <tbody>{o.rooms.map((r) => (
                <tr key={r.id} className={`${r.selectable ? 'click' : 'dim'} ${to === r.id ? 'sel' : ''}`} title={r.why || ''} onClick={() => r.selectable && setTo(r.id)}>
                  <td><b>{r.room_no}</b></td><td>{r.category}</td><td className="num">{peso(r.rate_per_night)}</td>
                  <td>{r.selectable ? <Badge>{r.hk_status}</Badge> : <span className="small" style={{ color: 'var(--red)' }}>{r.why}</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn outline" onClick={() => { reloadOptions(); if (to && !o.rooms.find((r) => r.id === to)?.selectable) setTo(null); }}>Check Availability</button>
            <span className="small muted" style={{ flex: 1 }}>Only rooms free for every remaining night ({fmtDate(o.window.start)} to {fmtDate(o.window.end)}) and ready can be picked.</span>
          </div>
        </Panel>
        <Panel num={3} title="Price impact">
          <div className="kv">
            <span>Current rate per night</span><span>{peso(o.current_rate)}</span>
            <span>New rate per night</span><span>{target ? peso(target.rate_per_night) : '-'}</span>
            <span>Difference per night</span><span>{target ? `${diff >= 0 ? '+ ' : ''}${peso(diff)}` : '-'}</span>
            <span>Nights remaining</span><span>{o.window.nights}</span>
            <b>Upgrade value</b><b>{peso(value)}</b>
          </div>
          {target && (
            <div className={isPaid ? 'note' : 'okmsg'} style={{ marginTop: 10 }}>
              <b>{isPaid ? 'Guest pays the difference' : isWaiver ? 'Waived: fault on resort side' : lower ? 'Lower-rate room: rate kept' : 'Same rate: no charge'}</b>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Amount to collect</span><b style={{ fontSize: 18 }}>{peso(isPaid ? value : 0)}</b></div>
            </div>
          )}
          {lower && <p className="open">Refund / credit for a lower-rate room is not built until decided (RT-03).</p>}
        </Panel>
      </div>
      <div className="grid g3">
        <Panel num={4} title="What happens when the transfer is confirmed" className="span2">
          {target ? (
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              <li>{target.room_no} ({target.category}) is assigned for the remaining {o.window.nights} night(s). {o.line.room_no} leaves this stay.</li>
              <li>{type === 'fault' ? `${o.line.room_no} becomes Blocked / Under Repair${reportDefect ? ' and Housekeeping is told about the defect' : ''}.` : `${o.line.room_no} becomes Dirty if the guest used it, otherwise it stays Clean.`}</li>
              <li>{isPaid ? `The ${peso(value)} upgrade difference is billed to the stay and paid before confirming.` : isWaiver ? `The guest keeps paying ${peso(o.current_rate)} per night. The ${peso(value)} difference is waived and logged.` : 'No price change.'}</li>
              <li>The folio and all charges stay on the same stay. Nothing is posted twice.</li>
              <li>History keeps both rooms, reason, {isWaiver ? 'approver, ' : ''}amounts, time and user.</li>
            </ul>
          ) : <p className="muted">Choose a reason and a new room.</p>}
          <p className="open">Upgrade amount rule, waiver length and lower-rate rooms: TO CONFIRM (RT-01, RT-03, RT-04).</p>
        </Panel>
        {isPaid ? (
          <Panel num={5} title="Payment of the difference">
            <p className="open small">Receipt type: OD-13</p>
            <TenderEntry due={value} exact buttons busy={a.busy} submitLabel="Record payment & Confirm Transfer" onSubmit={(tenders) => ready ? submit(tenders) : false} />
          </Panel>
        ) : (
          <Panel num={5} title="Approval">
            {isWaiver ? (<>
              <p className="small">A waiver needs Supervisor approval. <Open id="RT-02">who may approve</Open></p>
              <Field label="Approving user" hint={<Proposed />}>
                <select value={approverReq} onChange={(e) => setApproverReq(e.target.value)} disabled={appr?.status === 'Pending'}>
                  <option value="">[Front Office Supervisor]</option>
                  {(approvers?.approvers || []).map((u) => <option key={u.username} value={u.username}>{u.full_name} ({u.username})</option>)}
                </select>
              </Field>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <div><div className="small muted">Status</div><Badge t={appr?.status === 'Approved' ? 'green' : appr?.status === 'Rejected' ? 'red' : 'amber'}>{(appr?.status || 'Not requested').toUpperCase()}</Badge></div>
                <button className="btn" disabled={!reason || !target || a.busy || appr?.status === 'Pending' || appr?.status === 'Approved'}
                  onClick={() => a.run(async () => {
                    const r = await api.post('/approvals', {
                      type: 'transfer_waiver', entity: 'reservation', entity_id: Number(id), approver_requested: approverReq || null, reason,
                      payload: { line_id: Number(lineId), to_room_id: to, from_room: o.line.room_no, to_room: target.room_no, upgrade_value: value, nights: o.window.nights },
                      summary: `${res.reservation.reference} ${res.guest.full_name}: ${o.line.room_no} > ${target.room_no} free upgrade, waive ${peso(value)} (${o.window.nights} night/s). ${remarks}`.trim(),
                    });
                    setAppr(r.approval);
                  })}>{appr?.status === 'Rejected' ? 'Request again' : 'Request Approval'}</button>
              </div>
              {appr?.status === 'Pending' && <p className="small open" style={{ marginTop: 8 }}>Waiting for the supervisor. This screen updates by itself once it is approved.</p>}
              {appr?.status === 'Approved' && <p className="small" style={{ color: 'var(--green)', marginTop: 8 }}>Approved by {appr.decided_by} {appr.decision_note ? `- ${appr.decision_note}` : ''}</p>}
              {appr?.status === 'Rejected' && <p className="small" style={{ color: 'var(--red)', marginTop: 8 }}>Rejected by {appr.decided_by}: {appr.decision_note}</p>}
              <p className="small muted">Approver, time and reason are logged.</p>
            </>) : <p className="muted small">No approval or payment needed for a same-rate or lower-rate move.</p>}
          </Panel>
        )}
      </div>
      <ErrorBox error={a.error} />
      <div className="actionbar">
        <button className="btn outline" onClick={() => nav(-1)}>Cancel</button>
        {isWaiver ? <span className="check small"><input type="checkbox" readOnly checked={appr?.status === 'Approved'} /> <b style={{ color: appr?.status === 'Approved' ? 'var(--green)' : 'var(--amber)' }}>{appr?.status === 'Approved' ? 'Supervisor approved' : 'Waiting for supervisor approval'}</b></span>
          : <span className="small">{!reason ? 'Choose a reason' : !target ? 'Choose a new room' : isPaid ? 'Record the payment to confirm' : 'Ready'}</span>}
        <span className="sp" />
        {!isPaid && <button className={`btn gold ${ready ? '' : 'locked'}`} disabled={!ready || a.busy} onClick={() => submit(undefined)}>Confirm Transfer</button>}
      </div>
    </div>
  );
}
