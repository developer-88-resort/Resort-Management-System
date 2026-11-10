// Department sales & charges (Restaurant, Mini Bar, Massage) - the bridge that posts to Front Office accounts.
// Pay Now: department's own receipt, NOT posted to the folio. Charge: posts once to Room / Locker / Group.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fileToPayload } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AttachmentLink, Badge, ErrorBox, Field, FileInput, Panel, ReasonModal, useAction, useLoad } from '../components/ui.jsx';
import { fmtDateTime, localToday, peso, toCents } from '../util.js';

const OWN = { restaurant: 'Restaurant', minibar: 'Mini Bar', massage: 'Massage' };

export default function DepartmentPOS() {
  const { user, settings } = useAuth();
  const nav = useNavigate();
  const own = OWN[user.role];
  const [dept, setDept] = useState(own || 'Restaurant');
  const [items, setItems] = useState([{ name: '', qty: 1, price: '' }]);
  const [method, setMethod] = useState('charge');
  const [ttype, setTtype] = useState('room');
  const [target, setTarget] = useState('');
  const [tender, setTender] = useState(settings.payment_methods?.[0]);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [voiding, setVoiding] = useState(null);
  const [bill, setBill] = useState(null);
  const [targets, reloadTargets] = useLoad('/department/targets');
  const [list, reloadList] = useLoad(`/department/transactions?department=${encodeURIComponent(dept)}&from=${localToday()}`);
  const a = useAction();
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (toCents(i.price) || 0), 0);
  const valid = items.every((i) => i.name && Number(i.qty) > 0 && toCents(i.price) > 0) && (method === 'direct' || target);
  const upd = (k, f, v) => setItems(items.map((it, j) => (j === k ? { ...it, [f]: v } : it)));

  const submit = () => a.run(async () => {
    const body = {
      department: dept, method, note,
      items: items.map((i) => ({ name: i.name, qty: Number(i.qty), price: toCents(i.price) })),
      ...(method === 'charge'
        ? { target: ttype === 'room' ? { type: 'room', room_no: target } : ttype === 'locker' ? { type: 'locker', locker_id: target } : { type: 'group', group_ref: target } }
        : { direct_tender: tender, direct_reference: ref }),
      bill_file: method === 'charge' && bill ? await fileToPayload(bill) : null,
    };
    const res = await api.post('/department/transactions', body);
    setItems([{ name: '', qty: 1, price: '' }]); setTarget(''); setNote(''); setRef('');
    reloadList(); reloadTargets();
    nav(`/department/slip/${res.transaction.id}`);
  });

  const opts = ttype === 'room' ? (targets?.rooms || []).map((r) => [r.room_no, `${r.room_no} - ${r.full_name} (${r.reference})`])
    : ttype === 'locker' ? (targets?.lockers || []).map((l) => [l.locker_id, `${l.locker_id} - ${l.group_name} (${l.reference})`])
      : (targets?.groups || []).map((g) => [g.reference, `${g.reference} - ${g.group_name}`]);

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>{dept} - Sales & Charges</h1>
        {!own && <select value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 'auto' }}>{Object.values(OWN).map((d) => <option key={d}>{d}</option>)}</select>}
        <span className="sp" /><span className="muted small">Every posting carries one unique source transaction ID. A retry never posts twice.</span>
      </div>
      <div className="grid g3">
        <Panel num={1} title="Items" className="span2">
          <table className="tbl">
            <thead><tr><th>Item</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 140 }}>Price</th><th className="right">Amount</th><th /></tr></thead>
            <tbody>
              {items.map((it, k) => (
                <tr key={k}>
                  <td><input value={it.name} onChange={(e) => upd(k, 'name', e.target.value)} placeholder="Item / service" /></td>
                  <td><input type="number" min={1} value={it.qty} onChange={(e) => upd(k, 'qty', e.target.value)} /></td>
                  <td><input className="num" value={it.price} onChange={(e) => upd(k, 'price', e.target.value)} /></td>
                  <td className="num">{peso((Number(it.qty) || 0) * (toCents(it.price) || 0))}</td>
                  <td>{items.length > 1 && <button className="linkbtn red" onClick={() => setItems(items.filter((_, j) => j !== k))}>remove</button>}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={3}>TOTAL</td><td className="num">{peso(total)}</td><td /></tr>
            </tbody>
          </table>
          <button className="btn outline sm" style={{ marginTop: 8 }} onClick={() => setItems([...items, { name: '', qty: 1, price: '' }])}>+ Add item</button>
        </Panel>
        <Panel num={2} title="Payment">
          <div className="stack" style={{ gap: 10 }}>
            <div className="seg"><button type="button" className={method === 'direct' ? 'on' : ''} onClick={() => setMethod('direct')}>Pay Now</button><button type="button" className={method === 'charge' ? 'on' : ''} onClick={() => setMethod('charge')}>Charge to account</button></div>
            {method === 'direct' ? (<>
              <Field label="Payment method"><select value={tender} onChange={(e) => setTender(e.target.value)}>{settings.payment_methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Reference"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              <div className="note small">Recorded and receipted by {dept}. Marked Paid and NOT posted to the room or locker balance.</div>
            </>) : (<>
              <div className="seg">{[['room', 'Room'], ['locker', 'Locker'], ['group', 'Group']].map(([k, l]) => <button key={k} type="button" className={ttype === k ? 'on' : ''} onClick={() => { setTtype(k); setTarget(''); }}>{l}</button>)}</div>
              <Field label={ttype === 'room' ? 'Checked-in room' : ttype === 'locker' ? 'Issued locker (RED-015 / BLUE-102)' : 'Day Tour group'}>
                <input list="targets" value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} placeholder={ttype === 'room' ? 'VR101' : ttype === 'locker' ? 'RED-015' : 'DT-0001'} />
                <datalist id="targets">{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</datalist>
              </Field>
              <div className="small muted">{opts.find(([v]) => v === target)?.[1] || (target ? 'Not found in active accounts' : `${opts.length} active`)}</div>
              <FileInput label="Signed charge bill (optional; can be attached later from the slip)" onChange={setBill} />
              <div className="note small">Posts to the Front Office account immediately. A charge slip is printed for the guest's signature. Front Office issues the official receipt on settlement.</div>
            </>)}
            <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <ErrorBox error={a.error} />
            <button className="btn gold" disabled={!valid || a.busy} onClick={submit}>{method === 'direct' ? `Record sale ${peso(total)}` : `Post charge ${peso(total)}`}</button>
          </div>
        </Panel>
      </div>
      <Panel title={`Today's ${dept} transactions`}>
        <div className="tablewrap">
          <table className="tbl">
            <thead><tr><th>Source ID</th><th>Time</th><th>Method</th><th>Charged to</th><th>Items</th><th>By</th><th className="right">Amount</th><th /></tr></thead>
            <tbody>{(list?.transactions || []).map((t) => (
              <tr key={t.id} className={t.amount < 0 ? 'dim' : ''}>
                <td className="mono"><Link to={`/department/slip/${t.id}`}>{t.source_txn_id}</Link>{t.attachment_id && <div><AttachmentLink id={t.attachment_id}>bill</AttachmentLink></div>}</td><td>{fmtDateTime(t.created_at)}</td>
                <td><Badge t={t.method === 'direct' ? 'green' : 'navy'}>{t.method === 'direct' ? `Paid (${t.direct_tender})` : 'Charge'}</Badge></td>
                <td className="small">{t.target_label || '-'}</td><td className="small">{t.items.map((i) => `${i.name} x${i.qty}`).join(', ')}</td><td>{t.employee}</td>
                <td className="num">{peso(t.amount)}</td>
                <td>{t.amount > 0 && !t.reverses_txn_id && !list.transactions.some((x) => x.reverses_txn_id === t.source_txn_id) && <button className="linkbtn red" onClick={() => setVoiding(t)}>void</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
      {voiding && <ReasonModal title={`Void ${voiding.source_txn_id}`} needsApproval danger submitLabel="Post reversal" onClose={() => setVoiding(null)}
        onSubmit={async ({ reason, approval }) => { await api.post(`/department/transactions/${voiding.id}/void`, { reason, approval }); reloadList(); }}>
        <div className="note">A reversing transaction of {peso(-voiding.amount)} is posted to the same account. The original is never deleted.</div>
      </ReasonModal>}
    </div>
  );
}
