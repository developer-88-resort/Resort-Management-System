// Availability calendar: one live inventory shared by Marketing and Front Office.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field, useLoad } from '../components/ui.jsx';
import { addDays, localToday } from '../util.js';

export default function Availability() {
  const [from, setFrom] = useState(localToday());
  const [days, setDays] = useState(14);
  const [d, , err] = useLoad(`/rooms/calendar?from=${from}&days=${days}`);
  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Availability Calendar</h1><span className="sp" />
        <button className="btn outline sm" onClick={() => setFrom(addDays(from, -7))}>‹ Week</button>
        <Field label=""><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <button className="btn outline sm" onClick={() => setFrom(addDays(from, 7))}>Week ›</button>
        <select value={days} onChange={(e) => setDays(+e.target.value)} style={{ width: 'auto' }}><option value={14}>14 days</option><option value={31}>31 days</option></select>
        <Link className="btn gold" to="/reservations/new">+ New Reservation</Link>
      </div>
      <ErrorBox error={err} />
      {d && (
        <div className="panel tablewrap" style={{ maxHeight: '75vh' }}>
          <table className="cal">
            <thead><tr><th style={{ left: 0, zIndex: 2 }}>Room</th>{d.dates.map((x) => {
              const dt = new Date(x + 'T00:00:00');
              return <th key={x}>{dt.toLocaleDateString('en-PH', { weekday: 'short' })}<br />{dt.getDate()}</th>;
            })}</tr></thead>
            <tbody>{d.rooms.map((r) => (
              <tr key={r.id}>
                <td className="room">{r.room_no} <span className="muted small">{r.category}</span></td>
                {d.dates.map((x) => {
                  const b = d.bookings.find((k) => k.room_id === r.id && k.check_in <= x && k.check_out > x);
                  if (b) {
                    const first = b.check_in === x || x === d.dates[0];
                    return <td key={x}><Link to={`/reservations/${b.reservation_id}`} title={`${b.reference} ${b.full_name}`}><span className={`bk ${b.line_status === 'Checked In' ? 'i' : 'a'}`}>{first ? b.full_name.split(',')[0] : ' '}</span></Link></td>;
                  }
                  return <td key={x} className={r.block_status !== 'None' && x === d.dates[0] ? 'blk' : ''} />;
                })}
              </tr>
            ))}</tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>
            <span className="badge" style={{ background: 'var(--teal)', color: '#fff' }}>Reserved</span> &nbsp;
            <span className="badge navy">In-house</span> &nbsp; Striped = currently blocked / under repair. A saved booking blocks the room even without payment.
          </p>
        </div>
      )}
    </div>
  );
}
