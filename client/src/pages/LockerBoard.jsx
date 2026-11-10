// Locker inventory: 400 Red (female) + 400 Blue (male) = 800 physical lockers.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, ReasonModal, useLoad } from '../components/ui.jsx';

import { Icon } from '../components/Design.jsx';

export default function LockerBoard() {
  const { can } = useAuth();
  const [color, setColor] = useState('Red');
  const [status, setStatus] = useState('');
  const [d, reload, err] = useLoad(`/daytour/lockers?color=${color}`);
  const [rel, setRel] = useState(null);
  const lockers = (d?.lockers || []).filter((l) => !status || l.locker_status === status);
  const bg = (s) => ({ Available: '#fff', 'Available after clearance': 'var(--green-soft)', Assigned: 'var(--navy)', Shared: 'var(--navy-2)', 'Key Returned - Unsettled': 'var(--gold-soft)', Lost: 'var(--red-soft)', 'Under Repair': 'var(--red-soft)' }[s]);
  const fg = (s) => (['Assigned', 'Shared'].includes(s) ? '#fff' : 'var(--ink)');
  return (
    <div className={`stack locker-workspace zone-${color.toLowerCase()}`}>
      <div className="pagehead locker-heading">
        <h1>Locker Board</h1>
        <span className="sp" />
        <label className="locker-status-filter"><span>Status</span><select aria-label="Locker status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All statuses</option>{Object.entries(d?.summary || {}).map(([k, v]) => <option key={k} value={k}>{k} ({v})</option>)}
        </select></label>
      </div>
      <ErrorBox error={err} />
      <div className="locker-zone-tabs" role="group" aria-label="Locker zone">{['Red', 'Blue'].map((c) => <button key={c} type="button" aria-pressed={color === c} className={`locker-zone-tab ${c.toLowerCase()} ${color === c ? 'on' : ''}`} onClick={() => setColor(c)}><span className="locker-zone-icon"><Icon name="locker" size={22} /></span><span><strong>{c === 'Red' ? 'RED' : 'BLUE'}</strong><small>{c === 'Red' ? 'Female' : 'Male'}</small></span><span className="zone-selection" aria-hidden="true" /></button>)}</div>
      <div className="locker-summary" aria-label="Locker status summary">{Object.entries(d?.summary || {}).map(([k, v]) => <div key={k} className={`locker-summary-item status-${k.replaceAll(' ', '-').toLowerCase()}`}><span className="locker-status-dot" /><span>{k}</span><strong>{v}</strong></div>)}</div>
      <section className="locker-inventory"><div className="locker-inventory-header"><span className="locker-inventory-title"><Icon name="locker" size={18} /><h2>{color === 'Red' ? 'RED / Female' : 'BLUE / Male'}</h2></span><span className="locker-visible-count">{lockers.length} lockers</span></div>
      {!d && !err && <div className="locker-empty" role="status">Loading lockers...</div>}
      {d && !lockers.length && <div className="locker-empty">No lockers match this status.</div>}
      <div className="locker-inventory-scroll" tabIndex={0} role="region" aria-label={`${color} locker inventory`}><div className="locker-tiles">
        {lockers.map((l) => (
          <div key={l.id} className={`locker-tile status-${l.locker_status.replaceAll(' ', '-').toLowerCase()}`} title={`${l.id} ${l.locker_status}${l.reference ? ' - ' + l.reference : ''}${l.status_note ? ' - ' + l.status_note : ''}`}
            style={{ background: bg(l.locker_status), color: fg(l.locker_status), cursor: ['Lost', 'Under Repair'].includes(l.locker_status) && can('approve') ? 'pointer' : 'default' }}
            role={['Lost', 'Under Repair'].includes(l.locker_status) && can('approve') ? 'button' : undefined}
            tabIndex={['Lost', 'Under Repair'].includes(l.locker_status) && can('approve') ? 0 : undefined}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }}
            onClick={() => ['Lost', 'Under Repair'].includes(l.locker_status) && can('approve') && setRel(l)}>
            <div className="locker-tile-top"><Icon name="locker" size={15} /><span className="locker-status-dot" /></div>
            <b className="locker-tile-number">{String(l.number).padStart(3, '0')}</b>
            <div className="locker-tile-detail">{l.reference ? <Link to={`/daytour/${l.reference}`} style={{ color: 'inherit' }}>{l.reference}</Link> : l.locker_status === 'Available' ? '' : l.locker_status === 'Available after clearance' ? 'Cleared' : l.locker_status}</div>
          </div>
        ))}
      </div></div>
      <div className="locker-inventory-footer">Lost / Under Repair: supervisor decision required to return to service.</div></section>
      {rel && <ReasonModal title={`Return ${rel.id} to service`} label="Decision note (key replaced / repaired)" onClose={() => setRel(null)} submitLabel="Release locker"
        onSubmit={async ({ reason }) => { await api.post(`/daytour/lockers/${rel.id}/release`, { note: reason }); await reload(); }} />}
    </div>
  );
}
