// New reservation / amend reservation (Part 1 Fig. 3). Saving blocks the room(s) at once; payment is not required.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Field, Panel, Proposed, useAction, Badge } from '../components/ui.jsx';
import { Icon } from '../components/Design.jsx';
import { addDays, centsToInput, localToday, nights, peso, toCents } from '../util.js';

const emptyCounts = { adults: 2, children: 0, seniors: 0, pwd: 0 };

export default function ReservationForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { settings } = useAuth();
  const [guest, setGuest] = useState({ full_name: '', contact_no: '', email: '' });
  const [checkIn, setCheckIn] = useState(localToday());
  const [checkOut, setCheckOut] = useState(addDays(localToday(), 1));
  const [source, setSource] = useState(settings.reservation_sources?.[0] || '');
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([]); // {id?, room_id, room_no, category, rate (input string), ...counts, locked}
  const [avail, setAvail] = useState(null);
  const [orig, setOrig] = useState(null);
  const a = useAction();

  useEffect(() => {
    if (!editing) return;
    api.get(`/reservations/${id}`).then((d) => {
      setOrig(d);
      setGuest({ full_name: d.guest.full_name, contact_no: d.guest.contact_no || '', email: d.guest.email || '' });
      setCheckIn(d.reservation.check_in); setCheckOut(d.reservation.check_out);
      setSource(d.reservation.source); setRemarks(d.reservation.remarks || '');
      setLines(d.lines.filter((l) => l.line_status !== 'Cancelled').map((l) => ({
        id: l.id, room_id: l.room_id, room_no: l.room_no, category: l.category, rate: centsToInput(l.rate_per_night),
        adults: l.adults, children: l.children, seniors: l.seniors, pwd: l.pwd, locked: l.line_status === 'Checked In',
      })));
    }).catch(a.setError);
  }, [id]); // eslint-disable-line

  useEffect(() => {
    if (!checkIn || !checkOut || checkOut <= checkIn) { setAvail(null); return; }
    const t = setTimeout(() => {
      api.get(`/rooms/availability?from=${checkIn}&to=${checkOut}${editing ? `&exclude_reservation=${id}` : ''}`).then(setAvail).catch(a.setError);
    }, 200);
    return () => clearTimeout(t);
  }, [checkIn, checkOut]); // eslint-disable-line

  const n = nights(checkIn, checkOut);
  const roomTotal = lines.reduce((s, l) => s + (toCents(l.rate) || 0) * n, 0);
  const dp = Math.round((roomTotal * Number(settings.down_payment_pct || 30)) / 100);
  const selected = new Set(lines.map((l) => l.room_id));
  const byCategory = useMemo(() => {
    const m = {};
    for (const r of avail?.rooms || []) (m[r.category] ||= []).push(r);
    return m;
  }, [avail]);

  const toggle = (r) => {
    if (selected.has(r.id)) setLines(lines.filter((l) => l.room_id !== r.id || l.locked));
    else if (r.available) setLines([...lines, { room_id: r.id, room_no: r.room_no, category: r.category, rate: centsToInput(r.rate_per_night), ...emptyCounts }]);
  };
  const upd = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const unavailableSelected = lines.filter((l) => avail && !avail.rooms.find((r) => r.id === l.room_id)?.available && !l.locked);

  const save = () => a.run(async () => {
    const body = {
      guest, source, check_in: checkIn, check_out: checkOut, remarks, reason,
      lines: lines.map((l) => ({ id: l.id, room_id: l.room_id, rate_per_night: toCents(l.rate), adults: +l.adults, children: +l.children, seniors: +l.seniors, pwd: +l.pwd })),
    };
    const d = editing ? await api.put(`/reservations/${id}`, body) : await api.post('/reservations', body);
    nav(`/reservations/${d.reservation.id}`);
  });

  return (
    <div className="booking-form">
      <div className="pagehead booking-heading">
        <div><div className="eyebrow">FRONT OFFICE / RESERVATIONS</div><h1>{editing ? `Amend reservation ${orig?.reservation.reference || ''}` : 'New Reservation'}</h1><p className="muted">{editing ? 'Update the stay details and review your changes.' : 'A great stay starts with a warm welcome. Let\'s plan the details.'}</p></div>
        <span className="sp" />
        <div className="booking-header-tag"><Icon name="calendar" size={18} /><span>{editing ? 'Manage an existing stay' : 'Create a new stay'}</span></div>
      </div>
      <div className="booking-layout">
      <div className="booking-main">
      <div className="grid g2 booking-details">
        <Panel num={1} title="Guest information" className="booking-guest">
          <p className="booking-panel-description">Who are we welcoming?</p>
          <div className="stack" style={{ gap: 10 }}>
            <Field label="Primary guest name"><input value={guest.full_name} onChange={(e) => setGuest({ ...guest, full_name: e.target.value })} placeholder="Last name, First name" autoComplete="name" /></Field>
            <Field label="Contact number"><input placeholder="e.g. 0917 000 0000" autoComplete="tel" value={guest.contact_no} onChange={(e) => setGuest({ ...guest, contact_no: e.target.value })} /></Field>
            <Field label="Email (optional)"><input placeholder="guest@example.com" autoComplete="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></Field>
            <Field label="Booking source"><select value={source} onChange={(e) => setSource(e.target.value)}>{(settings.reservation_sources || []).map((s) => <option key={s}>{s}</option>)}{editing && !settings.reservation_sources?.includes(source) && <option>{source}</option>}</select></Field>
          </div>
        </Panel>
        <Panel num={2} title="Stay dates" className="booking-dates">
          <p className="booking-panel-description">Set the dates for your guest's stay.</p>
          <div className="stack" style={{ gap: 10 }}>
            <div className="grid g2">
              <Field label="Check-in date"><input type="date" value={checkIn} disabled={lines.some((l) => l.locked)} onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1)); }} /></Field>
              <Field label="Check-out date"><input type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} /></Field>
            </div>
            <div className="booking-nights"><Icon name="sun" size={18} /><span>Duration of stay</span><strong>{n > 0 ? `${n} night${n === 1 ? '' : 's'}` : '-'}</strong></div>
            <Field label="Remarks"><textarea placeholder="Special requests or notes for the stay..." value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            {editing && <Field label="Reason for the change (audit)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest asked to extend 1 night" /></Field>}
          </div>
        </Panel>

      </div>

      <Panel num={3} title="Choose your rooms" className="booking-rooms" right={<span className="room-selection-count">{lines.length} selected</span>}>
        <p className="booking-panel-description">Rooms available for every night of the stay. Click a room to add it. One guest can book several rooms of different categories.</p>
        <div className="room-selection-legend"><span><i className="available" />Available</span><span><i className="selected" />Selected</span><span><i className="unavailable" />Unavailable</span></div>
        {!avail && <p className="muted">Choose valid dates to see availability.</p>}
        {avail && Object.entries(byCategory).map(([cat, rooms]) => (
          <div key={cat} className="booking-category">
            <div className="booking-category-heading"><span className="category-bed"><Icon name="bed" size={18} /></span><h3>{cat}</h3><span className="category-rate">{peso(rooms[0].rate_per_night)} <span>/ night</span></span></div>
            <div className="booking-room-grid">
              {rooms.map((r) => (
                <button key={r.id} type="button" title={r.reason || 'Available'} onClick={() => toggle(r)}
                  aria-pressed={selected.has(r.id)} className={`btn room-choice ${selected.has(r.id) ? 'gold' : r.available ? 'outline' : ''}`} disabled={!r.available && !selected.has(r.id)}>
                  <Icon name="bed" size={19} /><span>{r.room_no}</span><span className="room-choice-mark" aria-hidden="true">{selected.has(r.id) ? '\u2713' : '+'}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {lines.length > 0 && (
          <div className="booking-selected"><div className="selected-rooms-heading"><h3>Selected rooms & occupants</h3><span>Review rates and guest counts below</span></div><div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>Room</th><th>Category</th><th>Rate / night</th><th>Adults</th><th>Children</th><th>Senior</th><th>PWD</th><th className="right">Line total</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.room_id} className={unavailableSelected.includes(l) ? 'sel' : ''}>
                    <td><b>{l.room_no}</b> {l.locked && <Badge>Checked In</Badge>}</td><td>{l.category}</td>
                    <td style={{ width: 120 }}><input aria-label={`Rate per night for ${l.room_no}`} className="num" value={l.rate} onChange={(e) => upd(i, 'rate', e.target.value)} /></td>
                    {['adults', 'children', 'seniors', 'pwd'].map((k) => (
                      <td key={k} style={{ width: 80 }}><input aria-label={`${k} in ${l.room_no}`} type="number" min={0} value={l[k]} onChange={(e) => upd(i, k, e.target.value)} /></td>
                    ))}
                    <td className="num">{peso((toCents(l.rate) || 0) * n)}</td>
                    <td>{!l.locked && <button className="linkbtn red" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">Accompanying guests are category counts, not full profiles. Changing the rate from the category rate is logged. <Proposed /></p>
          </div></div>
        )}
        {unavailableSelected.length > 0 && <div className="err">Not available for the new dates: {unavailableSelected.map((l) => l.room_no).join(', ')}. Choose other rooms. The original booking is kept until a valid change is saved.</div>}
      </Panel>
      <ErrorBox error={a.error} />
      </div>
      <aside className="booking-aside">
        <Panel num={4} title="Booking summary" className="booking-summary">
          <div className="summary-stay"><span className="summary-stay-icon"><Icon name="bed" size={23} /></span><div><strong>{lines.length ? `${lines.length} room${lines.length === 1 ? '' : 's'} selected` : 'Your stay at a glance'}</strong><span>{n > 0 ? `${n} night${n === 1 ? '' : 's'}` : 'Choose your stay dates'}</span></div></div>
          {lines.length > 0 && <div className="summary-room-chips">{lines.map((l) => <span key={l.room_id}>{l.room_no}</span>)}</div>}
          <div className="kv summary-breakdown">
            <span>Rooms</span><span>{lines.length}</span>
            <span>Room total ({n} night{n === 1 ? '' : 's'})</span><span>{peso(roomTotal)}</span>
            <span>Down payment requested ({settings.down_payment_pct}%)</span><span>{peso(dp)}</span>
            {orig && <><span>Received so far</span><span>{peso(orig.totals.paid)}</span></>}
          </div>
          <div className="summary-payment watch"><span>Room total</span><strong>{peso(roomTotal)}</strong><span>For the selected stay</span></div>
          <p className="small muted summary-policy">Down payment amount and due date follow settings <span className="open">(OD-02)</span>. A booking can be saved with no payment and stays Active / Unpaid.</p>
          {editing && <p className="small muted">No extra deposit is normally asked for a change; the updated balance is settled at check-in (FO-RSV-08).</p>}
        </Panel>
      <div className="actionbar booking-actions">
        <button className="btn outline" onClick={() => nav(-1)}>Cancel</button>
        <span className="sp" />
        <button className="btn gold" disabled={a.busy || !lines.length || n < 1 || unavailableSelected.length > 0} onClick={save}>{editing ? 'Save changes' : 'Create reservation (Save)'}</button>
      </div>
      <div className="booking-inventory-note"><Icon name="door" size={17} /><p>Marketing and Front Office share one live inventory. Saving blocks the room(s) at once, even before payment.</p></div>
      </aside>
      </div>
    </div>
  );
}
