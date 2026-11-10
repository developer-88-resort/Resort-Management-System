// Phase 1 room board: housekeeping status (Dirty > Cleaning In Progress > For Inspection > Clean), defects, blocks.
// Housekeeping status and availability are separate fields and are shown separately.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, Modal, Open, ReasonModal, useAction, useLoad } from '../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../util.js';

const NEXT = { Dirty: 'Cleaning In Progress', 'Cleaning In Progress': 'For Inspection', 'For Inspection': 'Clean' };

export default function RoomBoard() {
  const { can } = useAuth();
  const [d, reload, err] = useLoad('/rooms');
  const [defects, reloadDefects] = useLoad('/rooms/defects/list');
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState(null);
  const a = useAction();
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const rules = d.inspection_rule;
  const set = (room, to) => a.run(async () => { await api.post(`/rooms/${room.id}/hk-status`, { to }); await reload(); });
  const rooms = d.rooms.filter((r) => !filter || r.hk_status === filter || r.availability === filter);
  const counts = {};
  for (const r of d.rooms) { counts[r.hk_status] = (counts[r.hk_status] || 0) + 1; counts[r.availability] = (counts[r.availability] || 0) + 1; }
  const canHK = can('housekeeping');
  const sup = can('hk.supervise');
  const after = async () => { await reload(); await reloadDefects(); };

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Room Board</h1>
        <span className="muted small">Inspection rule: {rules === 'all' ? 'every turnover' : 'defect / repair rooms only'} <Open id="OD-04" /></span>
        <span className="sp" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All rooms ({d.rooms.length})</option>
          {['Dirty', 'Cleaning In Progress', 'For Inspection', 'Clean'].map((s) => <option key={s} value={s}>HK: {s} ({counts[s] || 0})</option>)}
          {['Available', 'Occupied', 'Reserved / Blocked', 'Not Ready', 'Under Repair / Blocked'].map((s) => <option key={s} value={s}>Availability: {s} ({counts[s] || 0})</option>)}
        </select>
      </div>
      <ErrorBox error={a.error} />
      <div className="board">
        {rooms.map((r) => {
          const next = NEXT[r.hk_status];
          const needsSup = next === 'Clean' && (rules === 'all' || r.needs_inspection);
          const skipInspection = r.hk_status === 'Cleaning In Progress' && !(rules === 'all' || r.needs_inspection);
          return (
            <div key={r.id} className={`roomcard ${r.hk_status.split(' ')[0]} ${r.hk_status === 'For Inspection' ? 'Inspection' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="no">{r.room_no}</span><span className="small muted">{r.category}</span></div>
              <div className="row" style={{ gap: 4 }}><span className="small muted" style={{ width: 82 }}>Housekeeping</span><Badge>{r.hk_status}</Badge></div>
              <div className="row" style={{ gap: 4 }}><span className="small muted" style={{ width: 82 }}>Availability</span><Badge>{r.availability}</Badge></div>
              {r.occupant && <div className="small">In-house: <Link to={`/reservations/${r.occupant.reservation_id}`}>{r.occupant.full_name}</Link> until {fmtDate(r.occupant.check_out)}</div>}
              {!r.occupant && r.next_arrival && <div className="small muted">Next: {r.next_arrival.full_name} {fmtDate(r.next_arrival.check_in)}</div>}
              {r.open_defects.map((x) => <div key={x.id} className="small" style={{ color: 'var(--red)' }}>⚠ {x.note}</div>)}
              {r.block_reason && <div className="small" style={{ color: 'var(--red)' }}>Blocked: {r.block_reason}</div>}
              <div className="row" style={{ gap: 4, marginTop: 'auto' }}>
                {canHK && skipInspection && <button className="btn sm" onClick={() => set(r, 'Clean')}>Mark Clean</button>}
                {canHK && next && !skipInspection && (!needsSup || sup) && <button className="btn sm" onClick={() => set(r, next)}>{next === 'Clean' ? 'Pass inspection' : next}</button>}
                {canHK && next && needsSup && !sup && <span className="small open">Awaiting supervisor</span>}
                {canHK && r.hk_status === 'Clean' && !r.occupant && <button className="btn sm outline" onClick={() => set(r, 'Dirty')}>Dirty</button>}
                {(canHK || can('frontdesk')) && <button className="btn sm ghost" onClick={() => setModal({ defect: r })}>Defect</button>}
                {sup && r.block_status === 'None' && <button className="btn sm ghost" onClick={() => setModal({ block: r })}>Block</button>}
                {sup && r.block_status !== 'None' && <button className="btn sm outline" onClick={() => setModal({ release: r })}>Release</button>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h3>Front Office events (last 24 hours)</h3>
        <table className="tbl"><thead><tr><th>When</th><th>Event</th><th>Room</th><th>Detail</th><th>By</th></tr></thead>
          <tbody>{(d.events || []).map((e, i) => (
            <tr key={i}><td className="small nowrap">{fmtDateTime(e.at)}</td><td><Badge t={e.label === 'Check-out' ? 'red' : e.label === 'Check-in' ? 'navy' : 'amber'}>{e.label}</Badge></td><td><b>{e.room || '-'}</b></td><td className="small">{e.detail}</td><td className="small">{e.by}</td></tr>
          ))}{!d.events?.length && <tr><td colSpan={5} className="muted">No events.</td></tr>}</tbody></table>
        <p className="small muted">Check-in and check-out events reach Housekeeping here. Front Office still confirms readiness with Housekeeping directly until management approves removing that step.</p>
      </div>
      <div className="panel">
        <h3>Unresolved room defects</h3>
        <table className="tbl"><thead><tr><th>Room</th><th>Defect</th><th>Source</th><th>Reported</th><th /></tr></thead>
          <tbody>{(defects?.defects || []).map((x) => (
            <tr key={x.id}><td><b>{x.room_no}</b></td><td>{x.note}</td><td className="small">{x.source}</td><td className="small">{x.reported_by} {fmtDateTime(x.reported_at)}</td>
              <td>{canHK && <button className="linkbtn" onClick={() => setModal({ resolve: x })}>resolve</button>}</td></tr>
          ))}{defects && !defects.defects.length && <tr><td colSpan={5} className="muted">None.</td></tr>}</tbody></table>
        <p className="small muted">Maintenance is still reached through existing offline channels. Front Office can view defects and blocks here.</p>
      </div>

      {modal?.defect && <DefectModal room={modal.defect} canBlock={sup} onClose={() => setModal(null)} onDone={after} />}
      {modal?.block && <ReasonModal title={`Block ${modal.block.room_no}`} onClose={() => setModal(null)} onSubmit={async ({ reason }) => { await api.post(`/rooms/${modal.block.id}/block`, { reason }); await after(); }} submitLabel="Block room" />}
      {modal?.release && <ReasonModal title={`Release ${modal.release.room_no} from repair`} label="Decision note" onClose={() => setModal(null)} onSubmit={async ({ reason }) => { await api.post(`/rooms/${modal.release.id}/release`, { note: reason }); await after(); }} submitLabel="Release">
        <div className="note">The room returns through For Inspection before it becomes Clean and Available.</div></ReasonModal>}
      {modal?.resolve && <ReasonModal title={`Resolve defect on ${modal.resolve.room_no}`} label="Resolution" onClose={() => setModal(null)} onSubmit={async ({ reason }) => { await api.post(`/rooms/defects/${modal.resolve.id}/resolve`, { resolution: reason }); await after(); }} submitLabel="Resolve" />}
    </div>
  );
}

function DefectModal({ room, canBlock, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const a = useAction();
  return (
    <Modal title={`Report defect: ${room.room_no}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={!note || a.busy} onClick={() => a.run(async () => { await api.post(`/rooms/${room.id}/defects`, { note, block }); await onDone(); onClose(); })}>Report</button></>}>
      <Field label="Defect"><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {canBlock && <label className="check"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Block the room (Under Repair)</label>}
      <ErrorBox error={a.error} />
    </Modal>
  );
}
