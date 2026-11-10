import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, useLoad } from '../components/ui.jsx';
import { fmtDate, peso } from '../util.js';

const STATUSES = ['', 'Active / Booked', 'Checked In', 'Checked Out', 'Cancelled'];

export default function Reservations({ view }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [arrival, setArrival] = useState('');
  const [filter, setFilter] = useState(view || 'upcoming');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (arrival) params.set('arrival', arrival);
  if (filter && !q && !status && !arrival) params.set('view', filter);
  const [data, , err] = useLoad(`/reservations?${params}`);
  return (
    <div className="stack">
      <div className="pagehead">
        <h1>{view === 'inhouse' ? 'In-house Guests' : view === 'pending' ? 'Waiting for Room (Check-in Pending)' : 'Reservations'}</h1>
        <span className="sp" />
        {can('reservation.edit') && <Link className="btn gold" to="/reservations/new">+ New Reservation</Link>}
      </div>
      <div className="panel">
        <div className="grid g4">
          <Field label="Search guest name, reference, contact"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Dela Cruz or RSV-000123" /></Field>
          <Field label="Reservation status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}</select></Field>
          <Field label="Arrival date"><input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field>
          <Field label="Quick view">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="upcoming">Upcoming & active</option><option value="inhouse">In-house</option><option value="pending">Waiting for Room</option><option value="">All</option>
            </select>
          </Field>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="panel tablewrap">
        <table className="tbl">
          <thead><tr><th>Reference</th><th>Guest</th><th>Contact</th><th>Rooms</th><th>Check-in</th><th>Check-out</th><th>Source</th><th>Reservation</th><th>Payment</th><th className="right">Total</th><th className="right">Outstanding</th></tr></thead>
          <tbody>
            {data?.reservations.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/reservations/${r.id}`)}>
                <td><b>{r.reference}</b></td><td>{r.full_name}</td><td>{r.contact_no}</td><td>{r.rooms}</td>
                <td className="nowrap">{fmtDate(r.check_in)}</td><td className="nowrap">{fmtDate(r.check_out)}</td><td>{r.source}</td>
                <td><Badge>{r.reservation_status}</Badge></td><td><Badge>{r.payment_status}</Badge></td>
                <td className="num">{peso(r.totals.total)}</td><td className="num"><b>{peso(r.totals.outstanding)}</b></td>
              </tr>
            ))}
            {data && !data.reservations.length && <tr><td colSpan={11} className="muted">No reservations found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
