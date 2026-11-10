import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { peso, tone, toCents, centsToInput } from '../util.js';
import { useAuth } from '../auth.jsx';

export function Panel({ num, title, right, children, className = '', style }) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || num) && (
        <div className="panel-h">
          {num != null && <span className="numdot">{num}</span>}
          <h2>{title}</h2>
          <span className="sp" />
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`field ${className}`}>
    <span>{label}{hint}</span>
    {children}
  </label>
);

export const Badge = ({ children, t }) => <span className={`badge ${t || tone(children)}`}>{children}</span>;
export const Proposed = ({ children = 'PROPOSED' }) => <span className="tag proposed">{children}</span>;
export const Open = ({ id, children }) => <span className="open">{children || 'TO CONFIRM'}{id ? ` (${id})` : ''}</span>;
export const Money = ({ c, className = '' }) => <span className={`num ${className}`}>{peso(c)}</span>;

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="err">
      <b>{error.message || String(error)}</b>
      {error.failures?.length > 0 && <ul>{error.failures.map((f) => <li key={f}>{f}</li>)}</ul>}
    </div>
  );
}

/** Loads data from the API; returns [data, reload, error, setData]. */
export function useLoad(url, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    if (!url) return;
    try { setError(null); setData(await api.get(url)); } catch (e) { setError(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, error, setData];
}

/** Wraps an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-h"><h2>{title}</h2><button className="btn ghost" onClick={onClose}>✕</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/** Supervisor approval: approve as yourself if you are a supervisor, otherwise supervisor credentials. */
export function ApprovalFields({ value, onChange }) {
  const { can } = useAuth();
  if (can('approve')) return <div className="note teal small">You are approving this as Front Office Supervisor. Your name is logged.</div>;
  return (
    <div className="grid g2">
      <Field label="Supervisor username" hint={<Proposed />}>
        <input value={value?.username || ''} onChange={(e) => onChange({ ...value, username: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Supervisor password">
        <input type="password" value={value?.password || ''} onChange={(e) => onChange({ ...value, password: e.target.value })} autoComplete="new-password" />
      </Field>
    </div>
  );
}

/**
 * Modal that collects a reason (and optionally approval), then calls onSubmit({reason, approval, ...extra}).
 */
export function ReasonModal({ title, label = 'Reason', needsApproval, onClose, onSubmit, children, submitLabel = 'Confirm', danger }) {
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState({});
  const a = useAction();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Back</button>
      <button className={`btn ${danger ? 'danger' : ''}`} disabled={a.busy || !reason.trim()} onClick={() => a.run(async () => { await onSubmit({ reason, approval }); onClose(); })}>{submitLabel}</button>
    </>}>
      {children}
      <Field label={label}><textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      {needsApproval && <ApprovalFields value={approval} onChange={setApproval} />}
      <ErrorBox error={a.error} />
    </Modal>
  );
}

/**
 * Split-tender entry (Cash, Card, GCash, Bank Transfer, Korean Bank). Several lines can settle one balance.
 * Calls onSubmit(tenders) where amounts are centavos. Over-collection is blocked client-side too.
 */
export function TenderEntry({ due, onSubmit, submitLabel = 'Record Payment', exact = false, busy, buttons = false }) {
  const { settings } = useAuth();
  const methods = settings.payment_methods || [];
  const [lines, setLines] = useState([]);
  const [method, setMethod] = useState(methods[0] || 'Cash');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const tendered = lines.reduce((s, l) => s + l.amount, 0);
  const left = due - tendered;
  useEffect(() => { setAmount(left > 0 ? centsToInput(left) : ''); }, [due, lines.length]); // eslint-disable-line
  const add = () => {
    const c = toCents(amount);
    if (!c || c <= 0 || c > left) return;
    setLines([...lines, { method, amount: c, reference: ref.trim() || null }]);
    setRef('');
  };
  const canSubmit = lines.length > 0 && (exact ? left === 0 : left >= 0) && !busy;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {buttons ? (
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Payment Method (split allowed)</div>
          <div className="row" style={{ gap: 6 }}>{methods.map((m) => <button key={m} type="button" className={`btn sm ${m === method ? '' : 'outline'}`} onClick={() => setMethod(m)}>{m}</button>)}</div>
        </div>
      ) : (
        <Field label="Payment Method"><select value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
      )}
      <div className="grid g2">
        <Field label="Amount"><input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
        <Field label="Reference"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={method === 'Cash' ? '-' : 'Txn / approval no.'} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
      </div>
      <div className="row"><button type="button" className="btn outline sm" onClick={add} disabled={!(toCents(amount) > 0 && toCents(amount) <= left)}>+ Add tender line</button>
        {toCents(amount) > left && left >= 0 && <span className="small" style={{ color: 'var(--red)' }}>Over-collection blocked</span>}</div>
      <table className="tbl">
        <thead><tr><th>Method</th><th className="right">Amount</th><th>Reference</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}><td>{l.method}</td><td className="num">{peso(l.amount)}</td><td>{l.reference || '-'}</td>
              <td className="right"><button className="linkbtn red" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></td></tr>
          ))}
          <tr className="total"><td>Total tendered {peso(tendered)}</td><td /><td colSpan={2} className="right">Left {peso(left)}</td></tr>
        </tbody>
      </table>
      <button className="btn" disabled={!canSubmit} onClick={async () => { const ok = await onSubmit(lines); if (ok) setLines([]); }}>{submitLabel}</button>
    </div>
  );
}

export const Check = ({ ok, children }) => <span className={ok ? 'ok' : 'no'}>{ok ? '☑' : '☐'} {children}</span>;

export { ApiError };

/** Opens an attachment (photo / PDF) that needs the auth header. */
export function AttachmentLink({ id, children = 'view' }) {
  if (!id) return null;
  const open = async () => {
    const { attachmentUrl } = await import('../api.js');
    window.open(await attachmentUrl(id), '_blank');
  };
  return <button type="button" className="linkbtn" onClick={open}>{children}</button>;
}

export const FileInput = ({ onChange, label = 'Attach photo / PDF' }) => (
  <Field label={label}><input type="file" accept="image/*,application/pdf" onChange={(e) => onChange(e.target.files[0] || null)} /></Field>
);
