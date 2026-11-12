import { Icon } from '../components/Design.jsx';
// Official settlement receipt (Part 2, Fig. 6 left). 80 mm thermal. Business identity from BIR settings (OD-13).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, useAction, useLoad } from '../components/ui.jsx';
import { fmtDateTime, peso, pesoSigned } from '../util.js';

export default function Receipt() {
  const { id } = useParams();
  const [d, , err, setD] = useLoad(`/payments/${id}/receipt`);
  const [reprint, setReprint] = useState(false);
  const a = useAction();
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const { payment: p, receipt: r, settings: s } = d;
  const isReprint = reprint || (r && r.last_printed_at);
  const print = () => a.run(async () => {
    const res = await api.post(`/payments/${id}/print`);
    setReprint(res.reprint); setD(res);
    setTimeout(() => window.print(), 50);
  });
  return (
    <div className="stack">
      <div className="row noprint">
        {r && <button className="btn gold" onClick={print}><Icon name="print" size={16} />{r.last_printed_at ? 'Reprint receipt' : 'Print receipt'}</button>}
        {d.account && <Link className="btn outline" to={d.account.link}>Back to {d.account.ref}</Link>}
        <span className="small muted">Reprints print the word REPRINT and are logged. Printed {r?.reprint_count ? `${r.reprint_count + 1} times` : r?.last_printed_at ? 'once' : 'not yet'}.</span>
      </div>
      <ErrorBox error={a.error} />
      <div className="receipt-wrap">
        <div className="receipt">
          <div className="c b">{s.business_name}</div>
          <div className="c">{s.business_address}</div>
          <div className="c">TIN: {s.business_tin}</div>
          <div className="dash" />
          <div className="c b">{(r?.doc_type || p.kind.toUpperCase()).toUpperCase()}</div>
          {r && <div className="c">No. {r.receipt_no}</div>}
          {isReprint && <div className="rp">REPRINT</div>}
          <div className="dash" />
          <div>Date    : {fmtDateTime(p.paid_at)}</div>
          <div className="l"><span>Cashier : {p.cashier}</span><span>Term: {s.terminal_id}</span></div>
          <div>Account : {d.account?.type} {d.account?.ref}</div>
          <div className="ind">{d.account?.name}</div>
          <div className="dash" />
          <div className="l b"><span>DESCRIPTION</span><span>AMOUNT</span></div>
          {d.lines.map((l, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <div>{l.label}</div>
              {l.sub.map((x, j) => <div key={j} className="l ind"><span>{x.label}</span><span>{pesoSigned(x.amount)}</span></div>)}
              <div className="l b"><span className="ind">Applied to this account</span><span>{peso(l.amount)}</span></div>
            </div>
          ))}
          <div className="dash" />
          {d.scpwd?.length > 0 && <>
            {d.scpwd.map((x, i) => <div key={i} className="l"><span>{x.category} discount{x.basis ? ` (${x.basis})` : ''}</span><span>({peso(x.amount)})</span></div>)}
            <div className="small">Formula and VAT per approved rule (OD-09 / OD-10)</div>
          </>}
          <div className="b">VAT breakdown  : [BIR format - OD-13]</div>
          <div className="dash" />
          <div className="l b"><span>TOTAL PAID</span><span>{pesoSigned(p.total)}</span></div>
          {d.tenders.map((t, i) => <div key={i} className="l ind"><span>{t.method}{t.reference ? ` ${t.reference}` : ''}</span><span>{pesoSigned(t.amount)}</span></div>)}
          <div className="l"><span>Change</span><span>0.00</span></div>
          {d.lines[0]?.balance != null && <div className="l"><span>Remaining balance</span><span>{pesoSigned(d.lines[0].balance)}</span></div>}
          <div className="dash" />
          <div>Payment ref: {p.payment_no}</div>
          <div className="c">{s.receipt_footer}</div>
          <div className="c b" style={{ marginTop: 6 }}>Document type and BIR fields pending accounting (OD-13)</div>
        </div>
      </div>
    </div>
  );
}
