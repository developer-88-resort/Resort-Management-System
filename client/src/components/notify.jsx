// Feedback for staff: toasts after every action, a confirmation step before actions that cannot be undone,
// and the notification bell for things that need attention.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';

// ------------------------------------------------------------------ toasts
export function toast(message, type = 'success', details) {
  window.dispatchEvent(new CustomEvent('irms:toast', { detail: { message, type, details } }));
}

export function Toaster({ placement = 'corner' }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let n = 0;
    const on = (e) => {
      const id = ++n + Date.now();
      setItems((x) => [...x.slice(-3), { id, ...e.detail }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), e.detail.type === 'error' ? 8000 : 4000);
    };
    window.addEventListener('irms:toast', on);
    return () => window.removeEventListener('irms:toast', on);
  }, []);
  return (
    <div className={`toasts noprint ${placement}`} role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
          <span className="toast-icon" aria-hidden="true">{t.type === 'error' ? '!' : t.type === 'info' ? 'i' : '✓'}</span>
          <div>
            <b>{t.message}</b>
            {t.details?.length > 0 && <ul>{t.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ confirmation
/** Resolves true when the user confirms. Usage: if (!(await askConfirm({...}))) return; */
export function askConfirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent('irms:confirm', { detail: { title, message, confirmLabel, danger, resolve } })));
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const on = (e) => setReq(e.detail);
    window.addEventListener('irms:confirm', on);
    return () => window.removeEventListener('irms:confirm', on);
  }, []);
  if (!req) return null;
  const close = (v) => { req.resolve(v); setReq(null); };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal" role="alertdialog" aria-modal="true">
        <div className="modal-h"><h2>{req.title}</h2></div>
        <div className="modal-b">{typeof req.message === 'string' ? <p style={{ margin: 0 }}>{req.message}</p> : req.message}</div>
        <div className="modal-f">
          <button className="btn outline" onClick={() => close(false)}>Back</button>
          <button className={`btn ${req.danger ? 'danger' : 'gold'}`} autoFocus onClick={() => close(true)}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ notification bell
export function NotificationBell() {
  const loc = useLocation();
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);
  const seen = useRef(null);
  useEffect(() => {
    let live = true;
    const load = () => api.get('/reports/alerts').then((d) => {
      if (!live) return;
      // A new alert after the first load also pops up as a toast.
      if (seen.current) for (const a of d.alerts) if (!seen.current.has(a.key)) toast(a.text, 'info');
      seen.current = new Set(d.alerts.map((a) => a.key));
      setAlerts(d.alerts);
    }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, [loc.pathname]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <div className="bell">
      <button type="button" className="bell-btn" aria-label={`Notifications (${alerts.length})`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {alerts.length > 0 && <span className="bell-count">{alerts.length}</span>}
      </button>
      {open && (
        <div className="bell-menu">
          <div className="bell-head">Notifications</div>
          {alerts.length === 0 && <div className="bell-empty">Nothing needs your attention.</div>}
          {alerts.map((a) => (
            <Link key={a.key} to={a.link} className={`bell-item ${a.level}`}><span className="bell-dot" />{a.text}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
