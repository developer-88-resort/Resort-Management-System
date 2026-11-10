// Group settlement and key return (Part 3, Fig. 3). Modes can be mixed per locker. One receipt per payment.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Check, ErrorBox, Field, Modal, Open, Panel, TenderEntry, useAction, useLoad } from '../components/ui.jsx';
import { centsToInput, peso, toCents } from '../util.js';
import { LockerActionModals } from './LockerAssignment.jsx';

const MODES = [
  ['rep', 'Representative pays all outstanding'],
  ['each', 'Each guest pays own locker'],
  ['org', 'Organizer pays entrance; guests pay add-ons'],
];

export default function GroupSettlement() {
  const { id } = useParams();
  const { settings, can } = useAuth();
  const [d, , err, setD] = useLoad(`/daytour/groups/${id}`);
  const [mode, setMode] = useState('rep');
  const [sel, setSel] = useState({}); // key: 'group' | accountId -> true
  const [modal, setModal] = useState(null);
  const [paid, setPaid] = useState(null);
  const [pick, setPick] = useState(false);
  const a = useAction();

  useEffect(() => {
    if (!d) return;
    // Default selection follows the chosen mode.
    const s = {};
    if (mode !== 'each' && d.totals.groupAccountBalance > 0) s.group = true;
    if (mode === 'rep') for (const acc of d.accounts) if (acc.balance > 0 && acc.payer === 'Representative') s[acc.id] = true;
    setSel(s);
  }, [d, mode]);

  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const g = d.group;
  const onSite = ['Arrived / Active', 'Settling'].includes(g.group_status);
  const allocations = [
    ...(sel.group && d.totals.groupAccountBalance > 0 ? [{ target_type: 'group', target_id: g.id, amount: d.totals.groupAccountBalance, label: 'Group account' }] : []),
    ...d.accounts.filter((acc) => sel[acc.id] && acc.balance > 0).map((acc) => ({ target_type: 'locker_account', target_id: acc.id, amount: acc.balance, label: acc.locker_id })),
  ];
  const due = allocations.reduce((s, x) => s + x.amount, 0);
  const setPayer = (acc, payer) => a.run(async () => setD(await api.put(`/daytour/locker-accounts/${acc.id}`, { payer })));
  // Applying a mode sets the Payer of every open locker; individual lockers can then be changed to mix modes.
  const applyMode = () => a.run(async () => {
    const payer = mode === 'rep' ? 'Representative' : 'Self';
    let last = null;
    for (const acc of d.accounts.filter((x) => x.status === 'Open' && x.payer !== payer)) last = await api.put(`/daytour/locker-accounts/${acc.id}`, { payer });
    if (last) setD(last);
  });
  const keysOut = d.accounts.filter((x) => x.key === 'Not returned');
  const target = keysOut.find((x) => sel[x.id]) || keysOut[0] || null;

  return (
    <div className="stack">
      <div className="banner">
        <div><div className="big">GROUP {g.reference} &nbsp; {g.group_name}</div>
          <div className="muted small">Entry charges: {d.totals.entryPaid ? 'PAID' : 'UNPAID'} &nbsp; Keys returned: {d.gates.keysReturned} of {d.gates.lockersIssued} &nbsp; Group outstanding: {peso(d.totals.outstanding)}</div></div>
        <span style={{ flex: 1 }} />
        <span className="badge amber" style={{ fontSize: 14, padding: '6px 16px' }}>STATUS: {g.group_status.toUpperCase()}</span>
      </div>
      {g.group_status === 'Checked Out' && <div className="okmsg">Group is Checked Out. <Link to={`/daytour/${id}`}>View group</Link></div>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2.4fr)' }}>
        <Panel num={1} title="Who pays">
          <div className="stack" style={{ gap: 10 }}>
            {MODES.map(([k, label]) => <label key={k} className="check"><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} /> {label}</label>)}
            {onSite && can('daytour') && <button className="btn sm outline" onClick={applyMode}>Apply to all lockers</button>}
            <p className="small muted">Set per locker in the table; modes can be mixed in one group. Organizer mode: the group account (entrance, Kubo / Cottage) is paid by the organizer and each locker by its own guests.</p>
          </div>
        </Panel>
        <Panel num={2} title="Lockers: key return and balance">
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th /><th>Locker</th><th>Type</th><th>Key</th><th>Charges</th><th className="right">Balance</th><th>Payer</th><th>Clearance</th>{can('daytour') && onSite && <th />}</tr></thead>
              <tbody>
                <tr className={sel.group ? 'sel' : ''}>
                  <td><input type="checkbox" disabled={d.totals.groupAccountBalance <= 0} checked={!!sel.group} onChange={() => setSel({ ...sel, group: !sel.group })} /></td>
                  <td><b>Group account</b></td><td colSpan={2} className="small muted">Entrance, Kubo / Cottage, group bills</td>
                  <td className="small">Entrance {peso(d.totals.entrance)}{d.totals.facility ? `, facility ${peso(d.totals.facility)}` : ''}{d.totals.groupDept ? `, bills ${peso(d.totals.groupDept)}` : ''}</td>
                  <td className="num">{peso(d.totals.groupAccountBalance)}</td><td>Organizer</td><td><Badge>{d.totals.groupAccountBalance > 0 ? 'Unsettled' : 'Cleared'}</Badge></td>{can('daytour') && onSite && <td />}
                </tr>
                {d.accounts.map((acc) => (
                  <tr key={acc.id} className={sel[acc.id] ? 'sel' : ''}>
                    <td><input type="checkbox" disabled={acc.balance <= 0} checked={!!sel[acc.id]} onChange={() => setSel({ ...sel, [acc.id]: !sel[acc.id] })} /></td>
                    <td><b className={`lk-${acc.color}`}>{acc.locker_id}</b></td><td>{acc.assignment_type}</td>
                    <td>{acc.key === 'Not returned' ? <b style={{ color: g.group_status === 'Settling' ? 'var(--red)' : 'var(--amber)' }}>{g.group_status === 'Settling' ? 'Key missing' : 'Not returned'}</b> : acc.key === 'Lost' ? <b style={{ color: 'var(--red)' }}>Lost (penalty)</b> : <b style={{ color: 'var(--green)' }}>Returned</b>}</td>
                    <td className="small">{[...acc.dept.map((x) => `${x.department} ${peso(x.amount)}`), ...acc.charges.map((c) => `${c.description} ${peso(c.amount)}`)].join(', ') || 'none'}</td>
                    <td className="num">{peso(acc.balance)}</td>
                    <td><select value={acc.payer} disabled={!onSite} onChange={(e) => setPayer(acc, e.target.value)} style={{ width: 140 }}><option>Representative</option><option>Self</option><option>Organizer</option></select></td>
                    <td><Badge t={acc.clearance === 'Cleared' ? 'green' : acc.clearance === 'Key out' ? 'red' : 'amber'}>{acc.clearance === 'Key out' ? 'Blocked: key' : acc.clearance}</Badge></td>
                    {can('daytour') && onSite && <td><div className="rowacts">{acc.key === 'Not returned' && <>
                      <button className="linkbtn" onClick={() => setModal({ kind: 'return', acc })}>Record Key Return</button>
                      <button className="linkbtn red" onClick={() => setModal({ kind: 'lost', acc })}>Lost key</button>
                      <button className="linkbtn" onClick={() => setModal({ kind: 'transfer', acc })}>Faulty</button></>}</div></td>}
                  </tr>
                ))}
                <tr className="total"><td colSpan={5}>Group outstanding (sum of accounts, no double counting)</td><td className="num">{peso(d.totals.outstanding)}</td><td colSpan={can('daytour') && onSite ? 3 : 2} /></tr>
              </tbody>
            </table>
          </div>
          {onSite && can('daytour') && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn outline" disabled={!keysOut.length} onClick={() => setModal({ kind: 'return', acc: target })}>Record Key Return{target ? ` (${target.locker_id})` : ''}</button>
              <button className="btn outline" disabled={!keysOut.length} onClick={() => setPick(true)}>Report Lost / Faulty Locker</button>
              <span className="small muted" style={{ flex: 1 }}>Tick a locker in the table to choose it; otherwise the first locker with its key out is used.</span>
            </div>
          )}
          <p className="small muted">Front Office checks the returned key against the assignment, then the balances including Restaurant, Massage and Mini Bar. A locker is Available only after its key is back and all linked charges are settled.</p>
        </Panel>
      </div>

      {onSite && can('daytour') && keysOut.length > 0 && <LostKeyPanel accounts={keysOut} settings={settings} onDone={setD} />}
      <div className="grid g2">
        <Panel num={3} title={`Payment (selected: ${allocations.map((x) => x.label).join(', ') || 'none'})`}>
          {onSite && can('daytour') && due > 0 ? (
            <div className="grid g2">
              <TenderEntry due={due} exact busy={a.busy} onSubmit={(tenders) => a.run(async () => {
                const res = await api.post(`/daytour/groups/${id}/payments`, { tenders, allocations: allocations.map(({ label, ...x }) => x), purpose: 'Group settlement' });
                setD(res); setPaid(res.payment); return res;
              })} />
              <div>
                <h3>Allocation preview</h3>
                <div className="kv">{allocations.map((x) => [<span key={x.label}>{x.label}</span>, <span key={x.label + 'v'}>{peso(x.amount)}</span>])}</div>
                <p className="small"><b>Group outstanding {peso(d.totals.outstanding)} to {peso(d.totals.outstanding - due)}. One receipt.</b></p>
                <p className="small open">Shared locker split by guest composition: TO CONFIRM (OD-10, OD-16). Document type: OD-13.</p>
              </div>
            </div>
          ) : <p className="muted">{d.totals.outstanding <= 0 ? 'Everything is settled.' : 'Select accounts with a balance to pay.'}</p>}
          {paid && <div className="okmsg" style={{ marginTop: 8 }}>{paid.payment_no} recorded. <Link to={`/receipt/${paid.id}`}>Print Receipt {paid.receipt?.receipt_no}</Link></div>}
        </Panel>
        <Panel num={5} title="Group clearance">
          <div className="stack" style={{ gap: 10 }}>
            <div className="checklist" style={{ flexDirection: 'column', gap: 6 }}>
              <Check ok={d.gates.allSettled}>All required charges settled</Check>
              <Check ok={d.gates.allKeysBack}>All keys returned or cleared ({d.gates.keysReturned} of {d.gates.lockersIssued})</Check>
            </div>
            <p className="small muted">Group becomes Checked Out only when both are done. A lost key is cleared once its penalty is recorded and paid <Open id="OD-15" />.</p>
            {g.group_status === 'Arrived / Active' && can('daytour') && <button className="btn outline" onClick={() => a.run(async () => setD(await api.post(`/daytour/groups/${id}/start-settlement`)))}>Start settlement (departure)</button>}
            <button className={`btn gold ${d.gates.allSettled && d.gates.allKeysBack && onSite ? '' : 'locked'}`} disabled={!(d.gates.allSettled && d.gates.allKeysBack && onSite) || a.busy}
              onClick={() => a.run(async () => setD(await api.post(`/daytour/groups/${id}/checkout`)))}>Check Out Group</button>
          </div>
        </Panel>
      </div>
      <ErrorBox error={a.error} />
      <div className="actionbar"><Link className="btn outline" to={`/daytour/${id}/lockers`}>Lockers</Link><Link className="btn outline" to={`/daytour/${id}`}>Group check-in</Link></div>
      <LockerActionModals modal={modal} setModal={setModal} onDone={setD} settings={settings} />
      {pick && <PickLostFaulty accounts={d.accounts.filter((x) => x.key === 'Not returned')} initial={d.accounts.find((x) => x.key === 'Not returned' && sel[x.id])?.id}
        onClose={() => setPick(false)} onPick={(kind, acc) => { setPick(false); setModal({ kind, acc }); }} />}
    </div>
  );
}

/** Panel 4: lost key. Penalty within the configured range chosen by management (OD-14); reissue rule is open. */
function LostKeyPanel({ accounts, settings, onDone }) {
  const [accId, setAccId] = useState(accounts[0]?.id);
  const [pen, setPen] = useState(centsToInput(settings.lost_key_penalty_min));
  const [note, setNote] = useState('Key not returned');
  const a = useAction();
  const acc = accounts.find((x) => x.id === Number(accId)) || accounts[0];
  return (
    <Panel num={4} title={`Lost key: ${acc?.locker_id || ''}`}>
      <div className="grid g4" style={{ alignItems: 'end' }}>
        <Field label="Locker with key out"><select value={acc?.id} onChange={(e) => setAccId(e.target.value)}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.locker_id}</option>)}</select></Field>
        <Field label={`Penalty (${peso(settings.lost_key_penalty_min)} to ${peso(settings.lost_key_penalty_max)})`} hint={<Open id="OD-14" />}><input className="num" value={pen} onChange={(e) => setPen(e.target.value)} /></Field>
        <Field label="Incident note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <button className="btn outline" disabled={a.busy || !acc} onClick={() => a.run(async () => onDone(await api.post(`/daytour/locker-accounts/${acc.id}/lost-key`, { penalty: toCents(pen), note })))}>Add Penalty and Mark Locker Lost</button>
      </div>
      <p className="small muted">Records the penalty, the responsible group, the locker, the payment and the incident. The locker stays unavailable until the security or replacement decision.</p>
      <ErrorBox error={a.error} />
    </Panel>
  );
}

/** Report Lost / Faulty Locker (Part 3 Fig. 3 panel 2): choose the locker and what happened. */
function PickLostFaulty({ accounts, initial, onClose, onPick }) {
  const [id, setId] = useState(initial || accounts[0]?.id);
  const acc = accounts.find((x) => x.id === Number(id));
  return (
    <Modal title="Report Lost / Faulty Locker" onClose={onClose} footer={<>
      <button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn danger" disabled={!acc} onClick={() => onPick('lost', acc)}>Lost key</button>
      <button className="btn" disabled={!acc} onClick={() => onPick('transfer', acc)}>Faulty locker (move guest)</button>
    </>}>
      <Field label="Locker with key out"><select value={id} onChange={(e) => setId(e.target.value)}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.locker_id} - {x.occupants}</option>)}</select></Field>
      <p className="small muted">Lost key: penalty within the configured range, locker stays unavailable (OD-14). Faulty: the guest moves to another locker and unpaid charges move with the account.</p>
    </Modal>
  );
}
