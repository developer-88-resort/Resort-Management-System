// Availability calendar: one live inventory shared by Marketing and Front Office.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, useLoad } from '../components/ui.jsx';
import { Icon } from '../components/Design.jsx';
import { addDays, fmtDate, localToday } from '../util.js';

export default function Availability() {
  const [from, setFrom] = useState(localToday());
  const [days, setDays] = useState(14);
  const [d, , err] = useLoad(`/rooms/calendar?from=${from}&days=${days}`);
  const today = localToday();
  return (
    <div className="availability-workspace">
      <div className="pagehead availability-heading">
        <h1>Availability Calendar</h1>
        <span className="sp" />
        <Link className="btn gold availability-create" to="/reservations/new"><Icon name="plus" size={18} />New Reservation</Link>
      </div>
      <ErrorBox error={err} />
      <section className="availability-planner" aria-label="Room availability planner">
        <div className="planner-toolbar">
          <div className="planner-period"><span className="planner-period-icon"><Icon name="calendar" size={23} /></span><div><h2>{d?.dates.length ? new Date(d.dates[0] + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : 'Room availability'}</h2><p>{d?.dates.length ? fmtDate(d.dates[0]) + ' - ' + fmtDate(d.dates[d.dates.length - 1]) : 'Choose a date to explore the calendar'}</p></div></div>
          <div className="planner-controls">
            <button type="button" className="btn outline planner-today" onClick={() => setFrom(localToday())}>Today</button>
            <div className="planner-date-nav">
              <button className="btn ghost planner-prev" aria-label="Previous week" title="Previous week" onClick={() => setFrom(addDays(from, -7))}><Icon name="arrow" size={17} /></button>
              <input aria-label="Calendar start date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <button className="btn ghost" aria-label="Next week" title="Next week" onClick={() => setFrom(addDays(from, 7))}><Icon name="arrow" size={17} /></button>
            </div>
            <select aria-label="Calendar range" value={days} onChange={(e) => setDays(+e.target.value)}><option value={14}>14 days</option><option value={31}>31 days</option></select>
          </div>
        </div>
        <div className="planner-meta">
          <div className="planner-inventory"><Icon name="bed" size={17} /><strong>{d ? d.rooms.length : '-'}</strong><span>rooms in view</span></div>
          <div className="planner-legend" aria-label="Calendar status legend"><span><i className="legend-available" />Available</span><span><i className="legend-reserved" />Reserved</span><span><i className="legend-inhouse" />In-house</span><span><i className="legend-blocked" />Blocked / under repair</span></div>
        </div>
        {!d && !err && <div className="planner-loading" role="status">Loading room availability...</div>}
        {d && (
          <div className="planner-scroll" tabIndex={0} role="region" aria-label="Scrollable room availability calendar">
            <table className="cal availability-grid" style={{ '--calendar-days': d.dates.length }}>
              <caption className="sr-only">Room availability from {d.dates[0]} to {d.dates[d.dates.length - 1]}. Booked cells open the reservation.</caption>
              <colgroup><col className="planner-room-col" />{d.dates.map((x) => <col key={x} />)}</colgroup>
              <thead><tr><th scope="col" className="planner-corner"><span>Rooms & categories</span></th>{d.dates.map((x) => {
                const dt = new Date(x + 'T00:00:00');
                return <th scope="col" key={x} className={`${x === today ? 'is-today' : ''} ${dt.getDay() === 0 || dt.getDay() === 6 ? 'is-weekend' : ''}`} aria-current={x === today ? 'date' : undefined}><span className="planner-weekday">{dt.toLocaleDateString('en-PH', { weekday: 'short' })}</span><span className="planner-day">{dt.getDate()}</span><span className="planner-month">{dt.toLocaleDateString('en-PH', { month: 'short' })}</span></th>;
              })}</tr></thead>
              <tbody>{d.rooms.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="planner-room"><span className="planner-room-icon"><Icon name="bed" size={17} /></span><span><strong>{r.room_no}</strong><small>{r.category}</small></span></th>
                  {d.dates.map((x) => {
                    const b = d.bookings.find((k) => k.room_id === r.id && k.check_in <= x && k.check_out > x);
                    if (b) {
                      const first = b.check_in === x || x === d.dates[0];
                      const last = addDays(x, 1) === b.check_out || x === d.dates[d.dates.length - 1];
                      return <td key={x} className={`planner-booked ${first ? 'booking-start' : ''} ${last ? 'booking-end' : ''}`}><Link to={`/reservations/${b.reservation_id}`} title={`${b.reference} ${b.full_name}`} aria-label={`${r.room_no}, ${fmtDate(x)}: ${b.full_name}, ${b.reference}, ${b.line_status}`}><span className={`bk ${b.line_status === 'Checked In' ? 'i' : 'a'}`}>{first ? b.full_name.split(',')[0] : '\u00a0'}</span></Link></td>;
                    }
                    return <td key={x} className={`${r.block_status !== 'None' && x === d.dates[0] ? 'blk' : ''} ${x === today ? 'today-cell' : ''}`} aria-label={`${r.room_no}, ${fmtDate(x)}${r.block_status !== 'None' && x === d.dates[0] ? ': currently blocked / under repair' : ''}`} />;
                  })}
                </tr>
              ))}</tbody>
            </table>
            {!d.rooms.length && <div className="planner-loading">No rooms to display.</div>}
          </div>
        )}
        <div className="planner-footer"><span><Icon name="door" size={16} />A saved booking blocks the room even without payment.</span></div>
      </section>
    </div>
  );
}
