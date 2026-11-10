import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, useLoad } from '../components/ui.jsx';
import { Icon } from '../components/Design.jsx';
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
  const title = view === 'inhouse' ? 'In-house Guests' : view === 'pending' ? 'Waiting for Room (Check-in Pending)' : 'Reservations';
  const filtered = !!(q || status || arrival);
  const views = [
    { value: 'upcoming', label: 'Upcoming & active', icon: 'calendar' },
    { value: 'inhouse', label: 'In-house', icon: 'bed' },
    { value: 'pending', label: 'Waiting for Room', icon: 'door' },
    { value: '', label: 'All reservations', icon: 'people' },
  ];
  return (
    <div className="reservations-workspace">
      <div className="pagehead reservations-heading">
        <div><div className="eyebrow">FRONT OFFICE / GUEST MANAGEMENT</div><h1>{title}</h1>
          <p className="muted">{view === 'inhouse' ? 'Every current stay, with guest details and balances in one place.' : view === 'pending' ? 'Keep track of guests waiting for their room to be ready.' : 'From the first booking to the next welcome. Manage every stay here.'}</p>
        </div>
        <span className="sp" />
        {can('reservation.edit') && <Link className="btn gold reservation-create" to="/reservations/new"><Icon name="plus" size={18} />New Reservation</Link>}
      </div>

      <section className="reservation-register" aria-label="Reservation directory">
        <div className="register-toolbar">
          <div className="register-title"><span className="register-icon"><Icon name="calendar" size={21} /></span><div><h2>Guest directory</h2><p>Bookings, stays & payment status</p></div></div>
          <span className="register-count" aria-live="polite">{data ? data.reservations.length : '-'} <span>results</span></span>
        </div>
        <div className="reservation-tabs" role="group" aria-label="Quick view">
          {views.map((item) => <button key={item.value} type="button" className={filter === item.value ? 'active' : ''} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}><Icon name={item.icon} size={17} />{item.label}</button>)}
        </div>
        <div className="reservation-filters">
          <Field label="Search reservations" className="reservation-search"><span className="search-input"><Icon name="search" size={19} /><input aria-label="Search guest name, reference, contact" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guest, reference or contact..." /></span></Field>
          <Field label="Reservation status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'Any status'}</option>)}</select></Field>
          <Field label="Arrival date"><input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field>
          {filtered && <button type="button" className="btn ghost clear-filters" onClick={() => { setQ(''); setStatus(''); setArrival(''); }}>Clear filters</button>}
        </div>
        {filtered && <div className="filter-context"><Icon name="filter" size={15} />Search, status and arrival filters apply across all reservations.</div>}
        <ErrorBox error={err} />
        <div className="reservation-table-scroll">
          <table className="tbl reservation-table">
            <thead><tr><th>Guest</th><th>Reference / source</th><th>Rooms</th><th>Stay dates</th><th>Reservation</th><th>Payment</th><th className="right">Total</th><th className="right">Outstanding</th><th><span className="sr-only">Open reservation</span></th></tr></thead>
            <tbody>
              {data?.reservations.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/reservations/${r.id}`)}>
                  <td><div className="guest-cell"><span className="guest-avatar" aria-hidden="true">{r.full_name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join('').toUpperCase()}</span><div><Link className="guest-name" to={`/reservations/${r.id}`}>{r.full_name}</Link><span className="cell-secondary">{r.contact_no || '?'}</span></div></div></td>
                  <td><span className="reservation-reference">{r.reference}</span><span className="cell-secondary">{r.source}</span></td>
                  <td><span className="room-label">{r.rooms}</span></td>
                  <td><div className="stay-dates"><span>{fmtDate(r.check_in)}</span><Icon name="arrow" size={13} /><span>{fmtDate(r.check_out)}</span></div><span className="cell-secondary">Check-in / Check-out</span></td>
                  <td><Badge>{r.reservation_status}</Badge></td><td><Badge>{r.payment_status}</Badge></td>
                  <td className="num">{peso(r.totals.total)}</td><td className="num outstanding-value"><b>{peso(r.totals.outstanding)}</b></td>
                  <td className="row-arrow"><Icon name="arrow" size={17} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data && !err && <div className="reservation-loading" role="status">Loading reservations...</div>}
        {data && !data.reservations.length && !err && <div className="reservation-empty">
          <div className="booking-illustration" aria-hidden="true"><span className="illustration-orbit" /><div className="illustration-calendar"><div className="illustration-calendar-top"><i /><i /></div><div className="illustration-calendar-grid">{Array.from({ length: 9 }, (_, i) => <span key={i} />)}</div></div><span className="illustration-search"><Icon name={filtered ? 'search' : 'calendar'} size={24} /></span></div>
          <span className="eyebrow">{filtered ? 'TRY ANOTHER SEARCH' : 'READY FOR YOUR NEXT GUEST'}</span>
          <h2>{filtered ? 'No matching reservations' : filter === 'inhouse' ? 'No guests in-house' : filter === 'pending' ? 'No guests waiting for a room' : 'Your next stay starts here'}</h2>
          <p>{filtered ? 'Try a different guest name, status or arrival date.' : filter === 'inhouse' ? 'Checked-in guests will appear here with their stay details.' : filter === 'pending' ? 'Guests waiting for room readiness will appear here.' : 'No reservations in this view yet. New bookings will appear here with all the details you need.'}</p>
          {filtered ? <button type="button" className="btn outline" onClick={() => { setQ(''); setStatus(''); setArrival(''); }}>Clear filters</button> : can('reservation.edit') && <Link className="btn outline" to="/reservations/new"><Icon name="plus" size={16} />Create a reservation</Link>}
        </div>}
        <div className="register-footer"><span>{data ? data.reservations.length : '-'} reservation{data?.reservations.length === 1 ? '' : 's'} in this view</span><span><Icon name="arrow" size={14} />Select a guest to view their reservation</span></div>
      </section>
      {can('reservation.view') && <div className="reservation-bottom-note"><Icon name="bed" size={17} /><span>Planning a stay? <Link to="/availability">Explore the availability calendar <Icon name="arrow" size={13} /></Link></span></div>}
    </div>
  );
}
