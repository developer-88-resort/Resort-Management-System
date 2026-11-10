import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Panel, useLoad } from '../components/ui.jsx';
import { peso, fmtDate } from '../util.js';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [d, , err] = useLoad('/reports/dashboard');
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const collected = (d.collections_today || []).reduce((s, x) => s + x.amount, 0);
  return (
    <div className="stack">
      <div className="pagehead"><h1>Good day, {user.full_name.split(' ')[0]}</h1><span className="muted">{fmtDate(d.today)}</span></div>
      <div className="grid g4">
        {d.arrivals && <div className="stat"><div className="v">{d.arrivals.length}</div><div className="l">Room arrivals today</div></div>}
        {d.inhouse != null && <div className="stat"><div className="v">{d.inhouse}</div><div className="l">Rooms in-house</div></div>}
        <div className="stat"><div className="v">{d.rooms.availability.Available || 0} / {d.rooms.total}</div><div className="l">Rooms available now</div></div>
        <div className="stat"><div className="v">{d.rooms.hk.Dirty || 0}</div><div className="l">Rooms Dirty</div></div>
        {d.groups && <div className="stat"><div className="v">{d.groups.filter((g) => g.group_status !== 'Advance Booking').length}</div><div className="l">Day Tour groups on site</div></div>}
        {d.lockers && <div className="stat"><div className="v">{(d.lockers.Assigned || 0) + (d.lockers.Shared || 0)}</div><div className="l">Lockers issued</div></div>}
        {d.collections_today && <div className="stat"><div className="v">{peso(collected)}</div><div className="l">Collected today</div></div>}
      </div>

      <div className="grid g2">
        {d.arrivals && (
          <Panel title="Arrivals today" right={can('reservation.edit') && <Link className="btn sm" to="/reservations/new">New reservation</Link>}>
            <table className="tbl"><thead><tr><th>Ref</th><th>Guest</th><th>Status</th><th>Payment</th><th className="right">Balance</th><th /></tr></thead>
              <tbody>
                {d.arrivals.map((a) => (
                  <tr key={a.id}><td><Link to={`/reservations/${a.id}`}>{a.reference}</Link></td><td>{a.full_name}</td>
                    <td><Badge>{a.reservation_status}</Badge></td><td><Badge>{a.payment_status}</Badge></td><td className="num">{peso(a.totals.outstanding)}</td>
                    <td>{can('frontdesk') && a.pending_rooms > 0 && <Link className="btn sm gold" to={`/reservations/${a.id}/checkin`}>Check-in</Link>}</td></tr>
                ))}
                {!d.arrivals.length && <tr><td colSpan={6} className="muted">No arrivals today.</td></tr>}
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
                {!d.departures.length && <tr><td colSpan={4} className="muted">No departures due.</td></tr>}
              </tbody></table>
          </Panel>
        )}
        {d.groups && (
          <Panel title="Day Tour today" right={can('daytour') && <Link className="btn sm" to="/daytour/new">New group</Link>}>
            <table className="tbl"><thead><tr><th>Group</th><th>Name</th><th>Status</th><th className="right">Guests</th><th className="right">Outstanding</th></tr></thead>
              <tbody>
                {d.groups.map((g) => (
                  <tr key={g.id}><td><Link to={`/daytour/${g.id}`}>{g.reference}</Link></td><td>{g.group_name}</td><td><Badge>{g.group_status}</Badge></td>
                    <td className="num">{g.actual_guests || g.estimated_guests}</td><td className="num">{peso(g.totals.outstanding)}</td></tr>
                ))}
                {!d.groups.length && <tr><td colSpan={5} className="muted">No groups today.</td></tr>}
              </tbody></table>
          </Panel>
        )}
        <Panel title="Rooms right now" right={<Link to="/rooms" className="small">Room board</Link>}>
          <div className="grid g2">
            <div><h3>Housekeeping</h3><div className="kv">{Object.entries(d.rooms.hk).map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + 'v'}>{v}</span>])}</div></div>
            <div><h3>Availability</h3><div className="kv">{Object.entries(d.rooms.availability).map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + 'v'}>{v}</span>])}</div></div>
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
