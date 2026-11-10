import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Panel, useLoad } from '../components/ui.jsx';
import { EmptyState, Icon, Metric } from '../components/Design.jsx';
import { peso, fmtDate } from '../util.js';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [d, , err] = useLoad('/reports/dashboard');
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const collected = (d.collections_today || []).reduce((s, x) => s + x.amount, 0);
  return (
    <div className="stack dashboard">
      <div className="pagehead dashboard-head">
        <div><div className="eyebrow">RESORT OVERVIEW</div><h1>Good day, {user.full_name.split(' ')[0]}<span className="greeting-dot">.</span></h1><p className="muted">Here's what's happening at the resort today.</p></div>
        <span className="sp" /><div className="date-chip"><Icon name="calendar" size={17} />{fmtDate(d.today)}</div>
      </div>
      <section className="overview-banner">
        <div className="overview-copy"><span className="eyebrow">YOUR DAILY SNAPSHOT</span><h2>A clear view. A smoother day.</h2><p>Manage stays, welcome guests, and keep every detail in view.</p>
          <div className="row">
            {can('reservation.edit') && <Link className="btn gold" to="/reservations/new">New reservation <Icon name="arrow" size={16} /></Link>}
            {can('daytour') && <Link className="btn outline" to="/daytour/new">New Day Tour group <Icon name="arrow" size={16} /></Link>}
          </div>
        </div>
        <div className="overview-art" aria-hidden="true"><span className="art-sun" /><span className="art-hill back" /><span className="art-hill front" /><span className="art-water one" /><span className="art-water two" /><span className="art-water three" /></div>
      </section>
      <div className="section-label"><h2>Today's activity</h2><span className="muted small">At a glance</span></div>
      <div className="grid g4 metrics-primary">
        {d.arrivals && <Metric icon="calendar" label="Room arrivals" value={d.arrivals.length} detail="Expected today" />}
        {d.inhouse != null && <Metric icon="bed" label="Rooms in-house" value={d.inhouse} detail="Current stays" tone="navy" />}
        <Metric icon="door" label="Rooms available" value={<>{d.rooms.availability.Available || 0}<span className="metric-total"> / {d.rooms.total}</span></>} detail="Available right now" />
        <Metric icon="sparkle" label="Rooms Dirty" value={d.rooms.hk.Dirty || 0} detail="Awaiting housekeeping" tone="gold" />
      </div>
      <div className="grid g3 metrics-secondary">
        {d.groups && <Metric icon="people" label="Day Tour groups on site" value={d.groups.filter((g) => g.group_status !== 'Advance Booking').length} detail="Today's groups" />}
        {d.lockers && <Metric icon="locker" label="Lockers issued" value={(d.lockers.Assigned || 0) + (d.lockers.Shared || 0)} detail="Assigned & shared" tone="navy" />}
        {d.collections_today && <Metric icon="wallet" label="Collected today" value={peso(collected)} detail="Across all payment methods" tone="gold" />}
      </div>
      <div className="section-label"><h2>On the schedule</h2><span className="muted small">Daily operations</span></div>

      <div className="grid g2">
        {d.arrivals && (
          <Panel title="Arrivals today" right={can('reservation.edit') && <Link className="btn sm outline" to="/reservations/new">+ New reservation</Link>}>
            <table className="tbl"><thead><tr><th>Ref</th><th>Guest</th><th>Status</th><th>Payment</th><th className="right">Balance</th><th /></tr></thead>
              <tbody>
                {d.arrivals.map((a) => (
                  <tr key={a.id}><td><Link to={`/reservations/${a.id}`}>{a.reference}</Link></td><td>{a.full_name}</td>
                    <td><Badge>{a.reservation_status}</Badge></td><td><Badge>{a.payment_status}</Badge></td><td className="num">{peso(a.totals.outstanding)}</td>
                    <td>{can('frontdesk') && a.pending_rooms > 0 && <Link className="btn sm gold" to={`/reservations/${a.id}/checkin`}>Check-in</Link>}</td></tr>
                ))}
                {!d.arrivals.length && <tr><td colSpan={6}><EmptyState icon="calendar" title="No arrivals today" detail="New arrivals will appear here." /></td></tr>}
              </tbody></table>
          </Panel>
        )}
        {d.departures && (
          <Panel title="Due to check out">
            <table className="tbl"><thead><tr><th>Ref</th><th>Guest</th><th className="right">Balance</th><th /></tr></thead>
              <tbody>
                {d.departures.map((a) => (
                  <tr key={a.id}><td><Link to={`/reservations/${a.id}`}>{a.reference}</Link></td><td>{a.full_name}</td><td className="num">{peso(a.totals.outstanding)}</td>
                    <td>{can('frontdesk') && <Link className="btn sm" to={`/reservations/${a.id}/checkout`}>Check-out</Link>}</td></tr>
                ))}
                {!d.departures.length && <tr><td colSpan={4}><EmptyState icon="door" title="No departures due" detail="Scheduled check-outs will appear here." /></td></tr>}
              </tbody></table>
          </Panel>
        )}
        {d.groups && (
          <Panel title="Day Tour today" right={can('daytour') && <Link className="btn sm outline" to="/daytour/new">+ New group</Link>}>
            <table className="tbl"><thead><tr><th>Group</th><th>Name</th><th>Status</th><th className="right">Guests</th><th className="right">Outstanding</th></tr></thead>
              <tbody>
                {d.groups.map((g) => (
                  <tr key={g.id}><td><Link to={`/daytour/${g.id}`}>{g.reference}</Link></td><td>{g.group_name}</td><td><Badge>{g.group_status}</Badge></td>
                    <td className="num">{g.actual_guests || g.estimated_guests}</td><td className="num">{peso(g.totals.outstanding)}</td></tr>
                ))}
                {!d.groups.length && <tr><td colSpan={5}><EmptyState icon="people" title="No groups today" detail="Your Day Tour groups will appear here." /></td></tr>}
              </tbody></table>
          </Panel>
        )}
        <Panel title="Rooms right now" right={<Link to="/rooms" className="room-board-link">Room board <Icon name="arrow" size={15} /></Link>}>
          <div className="grid g2">
            <div className="room-summary"><span className="summary-icon"><Icon name="sparkle" /></span><h3>Housekeeping</h3><div className="kv">{Object.entries(d.rooms.hk).map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + 'v'}>{v}</span>])}</div></div>
            <div className="room-summary"><span className="summary-icon"><Icon name="door" /></span><h3>Availability</h3><div className="kv">{Object.entries(d.rooms.availability).map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + 'v'}>{v}</span>])}</div></div>
          </div>
        </Panel>
        {d.collections_today && d.collections_today.length > 0 && (
          <Panel title="Collections today by method">
            <div className="kv">{d.collections_today.map((c) => [<span key={c.method}>{c.method}</span>, <span key={c.method + 'v'}>{peso(c.amount)}</span>])}</div>
          </Panel>
        )}
      </div>
    </div>
  );
}
