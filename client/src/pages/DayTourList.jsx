import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, useLoad } from '../components/ui.jsx';
import { ReservationActionLabel } from '../components/Design.jsx';
import { fmtDate, peso } from '../util.js';

export default function DayTourList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('onsite');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (date) p.set('date', date);
  if (q) p.set('q', q);
  const [d, , err] = useLoad(`/daytour/groups?${p}`);
  return (
    <div className="stack">
      <div className="pagehead"><h1>Day Tour Groups</h1><span className="sp" />{can('daytour') && <Link className="btn gold reservation-action" to="/daytour/new"><ReservationActionLabel icon="people">Walk-in / Advance Booking</ReservationActionLabel></Link>}</div>
      <div className="panel grid g3">
        <Field label="Search name, reference, contact"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="onsite">On site (Active / Settling)</option><option value="Advance Booking">Advance Booking</option><option value="Checked Out">Checked Out</option><option value="Cancelled">Cancelled</option><option value="">All</option>
        </select></Field>
        <Field label="Arrival date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <ErrorBox error={err} />
      <div className="panel tablewrap">
        <table className="tbl">
          <thead><tr><th>Reference</th><th>Group / Organizer</th><th>Type</th><th>Arrival</th><th className="right">Estimated</th><th className="right">Actual</th><th>Terms</th><th>Status</th><th className="right">Lockers</th><th className="right">Outstanding</th></tr></thead>
          <tbody>
            {d?.groups.map((g) => (
              <tr key={g.id} className="click" onClick={() => nav(g.group_status === 'Settling' ? `/daytour/${g.id}/settlement` : `/daytour/${g.id}`)}>
                <td><b>{g.reference}</b></td><td>{g.group_name}<div className="small muted">{g.contact_no}</div></td><td>{g.booking_type}</td><td>{fmtDate(g.arrival_date)}</td>
                <td className="num">{g.estimated_guests}</td><td className="num">{g.actual_guests}</td><td className="small">{g.payment_terms}</td><td><Badge>{g.group_status}</Badge></td>
                <td className="num">{g.lockers}</td><td className="num"><b>{peso(g.totals.outstanding)}</b></td>
              </tr>
            ))}
            {d && !d.groups.length && <tr><td colSpan={10} className="muted">No groups.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
