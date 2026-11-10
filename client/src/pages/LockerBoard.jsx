// Locker inventory: 400 Red (female) + 400 Blue (male) = 800 physical lockers.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, ReasonModal, useLoad } from '../components/ui.jsx';

export default function LockerBoard() {
  const { can } = useAuth();
  const [color, setColor] = useState('Red');
  const [status, setStatus] = useState('');
  const [d, reload, err] = useLoad(`/daytour/lockers?color=${color}`);
  const [rel, setRel] = useState(null);
  const lockers = (d?.lockers || []).filter((l) => !status || l.locker_status === status);
  const bg = (s) => ({ Available: '#fff', Assigned: 'var(--navy)', Shared: 'var(--navy-2)', 'Key Returned - Unsettled': 'var(--gold-soft)', Lost: 'var(--red-soft)', 'Under Repair': 'var(--red-soft)' }[s]);
  const fg = (s) => (['Assigned', 'Shared'].includes(s) ? '#fff' : 'var(--ink)');
  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Locker Board</h1>
        <div className="seg">{['Red', 'Blue'].map((c) => <button key={c} type="button" className={color === c ? 'on' : ''} onClick={() => setColor(c)}>{c === 'Red' ? 'RED / Female' : 'BLUE / Male'}</button>)}</div>
        <span className="sp" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All statuses</option>{Object.entries(d?.summary || {}).map(([k, v]) => <option key={k} value={k}>{k} ({v})</option>)}
        </select>
      </div>
      <ErrorBox error={err} />
      <div className="row">{Object.entries(d?.summary || {}).map(([k, v]) => <span key={k}><Badge>{k}</Badge> {v}</span>)}</div>
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 4 }}>
        {lockers.map((l) => (
          <div key={l.id} title={`${l.id} ${l.locker_status}${l.reference ? ' - ' + l.reference : ''}${l.status_note ? ' - ' + l.status_note : ''}`}
            style={{ border: '1px solid var(--line)', borderRadius: 4, padding: '4px 2px', textAlign: 'center', fontSize: 11, background: bg(l.locker_status), color: fg(l.locker_status), cursor: ['Lost', 'Under Repair'].includes(l.locker_status) && can('approve') ? 'pointer' : 'default' }}
            onClick={() => ['Lost', 'Under Repair'].includes(l.locker_status) && can('approve') && setRel(l)}>
            <b>{l.number}</b>
            <div style={{ fontSize: 9 }}>{l.reference ? <Link to={`/daytour/${l.reference}`} style={{ color: 'inherit' }}>{l.reference}</Link> : l.locker_status === 'Available' ? '' : l.locker_status.split(' ')[0]}</div>
          </div>
        ))}
      </div>
      <p className="small muted">Click a Lost or Under Repair locker to return it to service after the security / maintenance decision (supervisor).</p>
      {rel && <ReasonModal title={`Return ${rel.id} to service`} label="Decision note (key replaced / repaired)" onClose={() => setRel(null)} submitLabel="Release locker"
        onSubmit={async ({ reason }) => { await api.post(`/daytour/lockers/${rel.id}/release`, { note: reason }); await reload(); }} />}
    </div>
  );
}
