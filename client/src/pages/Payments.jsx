import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field, useLoad } from '../components/ui.jsx';
import { fmtDateTime, localToday, peso, pesoSigned } from '../util.js';

export default function Payments() {
  const [from, setFrom] = useState(localToday());
  const [to, setTo] = useState(localToday());
  const [d, , err] = useLoad(`/payments?from=${from}&to=${to}`);
  const byMethod = {};
  for (const p of d?.payments || []) for (const t of p.tenders) byMethod[t.method] = (byMethod[t.method] || 0) + t.amount;
  return (
    <div className="stack">
      <div className="pagehead"><h1>Cashier & Receipts</h1><span className="sp" />
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <ErrorBox error={err} />
      <div className="grid g4">{Object.entries(byMethod).map(([m, v]) => <div key={m} className="stat"><div className="v">{peso(v)}</div><div className="l">{m}</div></div>)}</div>
      <div className="panel tablewrap">
        <table className="tbl">
          <thead><tr><th>Payment</th><th>Receipt</th><th>Date</th><th>Account</th><th>Purpose</th><th>Tenders</th><th>Cashier</th><th className="right">Total</th></tr></thead>
          <tbody>{(d?.payments || []).map((p) => (
            <tr key={p.id}>
              <td className="mono">{p.payment_no}</td>
              <td>{p.receipt_no ? <Link to={`/receipt/${p.id}`}>{p.receipt_no}</Link> : <span className="small muted">{p.kind}</span>}{p.reprint_count > 0 && <span className="small muted"> ({p.reprint_count} reprint)</span>}</td>
              <td className="nowrap">{fmtDateTime(p.paid_at)}</td>
              <td>{p.account ? <Link to={p.account.link}>{p.account.ref}</Link> : '-'} <span className="small muted">{p.account?.name}</span></td>
              <td>{p.purpose}</td>
              <td className="small">{p.tenders.map((t) => `${t.method} ${peso(t.amount)}`).join(' + ')}</td>
              <td>{p.cashier}</td><td className="num">{pesoSigned(p.total)}</td>
            </tr>
          ))}
            {d && !d.payments.length && <tr><td colSpan={8} className="muted">No payments in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
