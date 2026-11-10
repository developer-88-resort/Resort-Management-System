// Supervisor approvals queue (Part 2 Fig. 2 panel 5a): requests stay PENDING until the supervisor decides.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, ReasonModal, useAction, useLoad } from '../components/ui.jsx';
import { fmtDateTime, peso } from '../util.js';

export default function Approvals() {
  const { can } = useAuth();
  const [status, setStatus] = useState('Pending');
  const [d, reload, err] = useLoad(`/approvals?status=${status}`);
  const [rejecting, setRejecting] = useState(null);
  const a = useAction();
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  const sup = can('approve');
  return (
    <div className="stack">
      <div className="pagehead">
        <h1>{sup ? 'Approvals' : 'My approval requests'}</h1>
        <span className="sp" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          {['Pending', 'Approved', 'Rejected', 'Withdrawn', 'All'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <ErrorBox error={err || a.error} />
      <div className="panel tablewrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Requested</th><th>Type</th><th>Request</th><th>Reason</th><th>Asked approver</th><th>Status</th><th>Decision</th><th /></tr></thead>
          <tbody>
            {(d?.approvals || []).map((x) => (
              <tr key={x.id}>
                <td>{x.id}</td>
                <td className="small nowrap">{x.requested_by}<br />{fmtDateTime(x.requested_at)}</td>
                <td className="small">{x.type_label}</td>
                <td className="small">{x.summary}{x.payload.upgrade_value != null && <div><b>Waive {peso(x.payload.upgrade_value)}</b></div>}
                  {x.entity === 'reservation' && <div><Link to={`/reservations/${x.entity_id}`}>Open reservation</Link></div>}</td>
                <td className="small">{x.reason}</td>
                <td className="small">{x.approver_requested || 'Any supervisor'}</td>
                <td><Badge t={x.status === 'Approved' ? 'green' : x.status === 'Pending' ? 'amber' : 'red'}>{x.status}</Badge>{x.used_at && <div className="small muted">used</div>}</td>
                <td className="small">{x.decided_by ? `${x.decided_by} ${fmtDateTime(x.decided_at)}` : '-'}{x.decision_note && <div>{x.decision_note}</div>}</td>
                <td className="nowrap">{sup && x.status === 'Pending' && <>
                  <button className="btn sm" disabled={a.busy} onClick={() => a.run(async () => { await api.post(`/approvals/${x.id}/approve`, {}); await reload(); })}>Approve</button>{' '}
                  <button className="btn sm danger" onClick={() => setRejecting(x)}>Reject</button></>}</td>
              </tr>
            ))}
            {d && !d.approvals.length && <tr><td colSpan={9} className="muted">No {status.toLowerCase()} requests.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">The cashier's screen unlocks Confirm only after approval. Each approval is tied to the exact room and can be used once. Approver, time and reason are logged.</p>
      {rejecting && <ReasonModal title={`Reject request #${rejecting.id}`} label="Reason for rejecting" danger submitLabel="Reject" onClose={() => setRejecting(null)}
        onSubmit={async ({ reason }) => { await api.post(`/approvals/${rejecting.id}/reject`, { note: reason }); await reload(); }} />}
    </div>
  );
}
