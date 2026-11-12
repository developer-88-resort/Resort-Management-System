import { Icon } from '../components/Design.jsx';
// Cutover opening records (Fixed decision 7, Part 3 s5). WinCloud history is NOT imported; live stays are entered by hand.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Field, Open, Panel, useAction, useLoad } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import { addDays, centsToInput, localToday, peso, toCents } from '../util.js';

export default function OpeningRecords() {
  const [f, setF] = useState({ full_name: '', contact_no: '', check_in: localToday(), check_out: addDays(localToday(), 1), in_house: true, wincloud_ref: '', opening_paid: '', opening_charges: '', remarks: '' });
  const [lines, setLines] = useState([]);
  const [avail, setAvail] = useState(null);
  const [done, setDone] = useState(null);
  const a = useAction();
  useEffect(() => {
    const from = f.check_in < localToday() ? localToday() : f.check_in;
    if (f.check_out <= from) return;
    api.get(`/rooms/availability?from=${from}&to=${f.check_out}`).then(setAvail).catch(a.setError);
  }, [f.check_in, f.check_out]); // eslint-disable-line
  const add = (id) => {
    const r = avail.rooms.find((x) => x.id === Number(id));
    if (r && !lines.find((l) => l.room_id === r.id)) setLines([...lines, { room_id: r.id, room_no: r.room_no, rate: centsToInput(r.rate_per_night), adults: 2, children: 0, seniors: 0, pwd: 0 }]);
  };
  const upd = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = () => a.run(async () => {
    const res = await api.post('/reservations/opening', {
      guest: { full_name: f.full_name, contact_no: f.contact_no }, check_in: f.check_in, check_out: f.check_out, in_house: f.in_house, wincloud_ref: f.wincloud_ref, remarks: f.remarks,
      opening_paid: toCents(f.opening_paid || 0), opening_charges: toCents(f.opening_charges || 0),
      lines: lines.map((l) => ({ room_id: l.room_id, rate_per_night: toCents(l.rate), adults: +l.adults, children: +l.children, seniors: +l.seniors, pwd: +l.pwd })),
    });
    setDone(res); setLines([]); setF({ ...f, full_name: '', contact_no: '', wincloud_ref: '', opening_paid: '', opening_charges: '', remarks: '' });
  });
  return (
    <div className="stack">
      <div className="pagehead"><h1>Cutover Opening Records</h1><span className="sp" /><span className="small muted">Phase 1 Front Office (rooms) and Phase 2 Day Tour</span></div>
      <div className="note">Historical WinCloud records are not imported. At cutover, enter each checked-in guest and each future reservation by hand, with the amount already received in WinCloud.
        Existing systems stay live until this module is ready; never record the same transaction in both. Detail of opening balances (summarized vs itemized) <Open id="OD-01" />.
        Day Tour groups on site at cutover are entered from <Link to="/daytour/new">Day Tour</Link>.</div>
      {done && <div className="okmsg">Saved <Link to={`/reservations/${done.reservation.id}`}>{done.reservation.reference}</Link> for {done.guest.full_name}. Outstanding {peso(done.totals.outstanding)}.</div>}
      <div className="grid g2">
        <Panel num={1} title="Stay">
          <div className="grid g2">
            <Field label="Guest name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
            <Field label="Contact number"><input value={f.contact_no} onChange={(e) => setF({ ...f, contact_no: e.target.value })} /></Field>
            <Field label="Check-in date (may be in the past)"><input type="date" value={f.check_in} onChange={(e) => setF({ ...f, check_in: e.target.value })} /></Field>
            <Field label="Check-out date"><input type="date" value={f.check_out} onChange={(e) => setF({ ...f, check_out: e.target.value })} /></Field>
            <Field label="WinCloud reference"><input value={f.wincloud_ref} onChange={(e) => setF({ ...f, wincloud_ref: e.target.value })} /></Field>
            <Field label="Status at cutover"><select value={f.in_house ? '1' : '0'} onChange={(e) => setF({ ...f, in_house: e.target.value === '1' })}><option value="1">Checked in (in-house)</option><option value="0">Future reservation</option></select></Field>
          </div>
        </Panel>
        <Panel num={2} title="Opening balance">
          <div className="grid g2">
            <Field label="Already received in WinCloud"><input className="num" value={f.opening_paid} onChange={(e) => setF({ ...f, opening_paid: e.target.value })} /></Field>
            <Field label="Unpaid extras already on WinCloud folio"><input className="num" value={f.opening_charges} onChange={(e) => setF({ ...f, opening_charges: e.target.value })} /></Field>
          </div>
          <Field label="Remarks"><textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </Panel>
      </div>
      <Panel num={3} title="Rooms">
        <select value="" onChange={(e) => add(e.target.value)} style={{ maxWidth: 360 }}>
          <option value="">Add room…</option>{(avail?.rooms || []).filter((r) => r.available).map((r) => <option key={r.id} value={r.id}>{r.room_no} {r.category} {peso(r.rate_per_night)}</option>)}
        </select>
        {lines.length > 0 && <table className="tbl" style={{ marginTop: 10 }}><thead><tr><th>Room</th><th>Rate / night</th><th>Adults</th><th>Children</th><th>Senior</th><th>PWD</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.room_id}><td><b>{l.room_no}</b></td><td><input className="num" value={l.rate} onChange={(e) => upd(i, 'rate', e.target.value)} /></td>
              {['adults', 'children', 'seniors', 'pwd'].map((k) => <td key={k}><input type="number" min={0} value={l[k]} onChange={(e) => upd(i, k, e.target.value)} /></td>)}
              <td><button className="linkbtn red" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></td></tr>
          ))}</tbody></table>}
      </Panel>
      <ErrorBox error={a.error} />
      <div className="actionbar"><span className="sp" /><button className="btn gold" disabled={!lines.length || !f.full_name || !f.wincloud_ref || a.busy} onClick={save}>Save room opening record</button></div>
      <DayTourOpening />
    </div>
  );
}

// Phase 2 Day Tour cutover (Part 3 s5): future group bookings, and any group still on site with its lockers and balances.
// Cutting over when no group is on site avoids hand-entering locker balances (PROPOSED timing).
function DayTourOpening() {
  const { settings } = useAuth();
  const blank = { on_site: true, group_name: '', contact_no: '', legacy_ref: '', arrival_date: localToday(), estimated_guests: '', payment_terms: settings.daytour_payment_terms?.[0], opening_paid: '', remarks: '' };
  const [f, setF] = useState(blank);
  const [counts, setCounts] = useState({});
  const [lockers, setLockers] = useState([]);
  const [rates] = useLoad('/daytour/rates');
  const [done, setDone] = useState(null);
  const a = useAction();
  const guestRates = (rates?.rates || []).filter((r) => r.kind === 'guest');
  const updL = (i, k, v) => setLockers(lockers.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = () => a.run(async () => {
    const res = await api.post('/daytour/opening', {
      ...f, estimated_guests: Number(f.estimated_guests) || 0, opening_paid: toCents(f.opening_paid || 0),
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0])),
      lockers: f.on_site ? lockers.map((l) => ({ ...l, opening_balance: toCents(l.opening_balance || 0) })) : [],
    });
    setDone(res); setF(blank); setCounts({}); setLockers([]);
  });
  return (
    <Panel num={4} title="Day Tour groups at cutover">
      <div className="stack">
        {done && <div className="okmsg">Saved <Link to={`/daytour/${done.group.id}`}>{done.group.reference}</Link> {done.group.group_name} ({done.group.group_status}). Outstanding {peso(done.totals.outstanding)}.</div>}
        <div className="grid g4">
          <Field label="Status at cutover"><select value={f.on_site ? '1' : '0'} onChange={(e) => setF({ ...f, on_site: e.target.value === '1' })}><option value="1">On site now (Arrived / Active)</option><option value="0">Future group booking</option></select></Field>
          <Field label="Group / organizer name"><input value={f.group_name} onChange={(e) => setF({ ...f, group_name: e.target.value })} /></Field>
          <Field label="Contact number"><input value={f.contact_no} onChange={(e) => setF({ ...f, contact_no: e.target.value })} /></Field>
          <Field label="Old system reference"><input value={f.legacy_ref} onChange={(e) => setF({ ...f, legacy_ref: e.target.value })} /></Field>
          {!f.on_site && <Field label="Arrival date"><input type="date" min={localToday()} value={f.arrival_date} onChange={(e) => setF({ ...f, arrival_date: e.target.value })} /></Field>}
          <Field label="Estimated guests"><input type="number" min={0} value={f.estimated_guests} onChange={(e) => setF({ ...f, estimated_guests: e.target.value })} /></Field>
          <Field label="Payment terms"><select value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })}>{(settings.daytour_payment_terms || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label={f.on_site ? 'Entrance already paid in old system' : 'Deposit already received'}><input className="num" value={f.opening_paid} onChange={(e) => setF({ ...f, opening_paid: e.target.value })} /></Field>
        </div>
        {f.on_site && (<>
          <h3>Actual guest counts</h3>
          <div className="grid g4">{guestRates.map((r) => <Field key={r.code} label={`${r.name} (${peso(r.amount)})`}><input type="number" min={0} value={counts[r.code] ?? ''} onChange={(e) => setCounts({ ...counts, [r.code]: e.target.value })} /></Field>)}</div>
          <h3>Lockers already issued</h3>
          <table className="tbl"><thead><tr><th>Locker ID</th><th>Type</th><th>Occupants</th><th>Unpaid balance from old system</th><th /></tr></thead>
            <tbody>{lockers.map((l, i) => (
              <tr key={i}>
                <td><input value={l.locker_id} onChange={(e) => updL(i, 'locker_id', e.target.value.toUpperCase())} placeholder="RED-015" /></td>
                <td><select value={l.assignment_type} onChange={(e) => updL(i, 'assignment_type', e.target.value)}><option>Individual</option><option>Shared</option></select></td>
                <td><input value={l.occupants} onChange={(e) => updL(i, 'occupants', e.target.value)} placeholder="1 Adult" /></td>
                <td><input className="num" value={l.opening_balance} onChange={(e) => updL(i, 'opening_balance', e.target.value)} /></td>
                <td><button className="linkbtn red" onClick={() => setLockers(lockers.filter((_, j) => j !== i))}>remove</button></td>
              </tr>
            ))}</tbody></table>
          <div><button type="button" className="btn sm outline panel-shortcut" onClick={() => setLockers([...lockers, { locker_id: '', assignment_type: 'Individual', occupants: '', opening_balance: '' }])}><Icon name="locker" size={16} /><span>Add locker</span></button></div>
        </>)}
        <Field label="Remarks"><input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        <ErrorBox error={a.error} />
        <div className="row end"><button className="btn gold" disabled={!f.group_name || !f.legacy_ref || a.busy} onClick={save}>Save Day Tour opening record</button></div>
      </div>
    </Panel>
  );
}
