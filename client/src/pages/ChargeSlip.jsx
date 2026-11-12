import { Icon } from '../components/Design.jsx';
// Department charge slip (Part 2, Fig. 6 right) - NOT an official receipt. 80 mm thermal, ~42 chars/line.
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, fileToPayload } from '../api.js';
import { AttachmentLink, ErrorBox, useAction, useLoad } from '../components/ui.jsx';
import { fmtDateTime, peso } from '../util.js';

export default function ChargeSlip() {
  const { id } = useParams();
  const [d, reload, err] = useLoad(`/department/transactions/${id}`);
  const [file, setFile] = useState(null);
  const a = useAction();
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const t = d.transaction;
  const charge = t.method === 'charge';
  return (
    <div className="stack">
      <div className="row noprint"><button className="btn gold" onClick={() => window.print()}><Icon name="print" size={16} />Print slip</button><Link className="btn outline" to="/department">Back</Link>
        <span className="small muted">Assumed 80 mm thermal paper. Printer model and command set: TO CONFIRM.</span></div>
      {d.transaction.method === 'charge' && (
        <div className="row noprint">
          {d.transaction.attachment_id ? <span className="small">Signed charge bill attached: <AttachmentLink id={d.transaction.attachment_id} /></span> : <span className="small muted">Attach the signed slip (photo / scan):</span>}
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} style={{ width: 'auto' }} />
          <button className="btn sm outline" disabled={!file || a.busy} onClick={() => a.run(async () => { await api.post(`/department/transactions/${d.transaction.id}/attachment`, { file: await fileToPayload(file) }); setFile(null); await reload(); })}>Attach signed bill</button>
          <ErrorBox error={a.error} />
        </div>
      )}
      <div className="receipt">
        <div className="c b">{d.settings.business_name}</div>
        <div className="c">{t.department.toUpperCase()}</div>
        <div className="dash" />
        <div className="c b">{charge ? 'CHARGE SLIP' : 'DEPARTMENT SALES SLIP'}</div>
        <div className="c b">NOT AN OFFICIAL RECEIPT</div>
        <div className="dash" />
        <div>Slip No : {t.source_txn_id}</div>
        <div>Date    : {fmtDateTime(t.created_at)}</div>
        <div>Server  : {t.employee}</div>
        {charge && <div>Charge to: {t.target_label}</div>}
        <div className="dash" />
        <div className="l b"><span>ITEM</span><span>QTY&nbsp;&nbsp;&nbsp;&nbsp;AMOUNT</span></div>
        {t.items.map((i, k) => <div key={k} className="l"><span>{i.name}</span><span>{i.qty}&nbsp;&nbsp;&nbsp;{peso(i.amount).padStart(10, ' ')}</span></div>)}
        <div className="dash" />
        <div className="l b"><span>TOTAL {charge ? 'CHARGE' : 'PAID'}</span><span>{peso(t.amount)}</span></div>
        {charge
          ? <div className="b">STATUS: {d.settled ? 'SETTLED at Front Office' : 'UNPAID - settle at Front Office'}</div>
          : <div className="b">PAID: {t.direct_tender}{t.direct_reference ? ` ${t.direct_reference}` : ''}</div>}
        {t.reverses_txn_id && <div className="b">REVERSAL OF {t.reverses_txn_id}</div>}
        <div className="dash" />
        {charge && (<>
          <div>Guest signature:</div><br /><br /><div>______________________________</div><br />
          <div>Keep this slip. The official receipt is issued by Front Office when you pay.</div>
        </>)}
      </div>
    </div>
  );
}
