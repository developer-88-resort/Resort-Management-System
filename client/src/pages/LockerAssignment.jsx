// Locker assignment and group locker list (Part 2, Fig. 5). Red keys = female 1-400, Blue keys = male 1-400.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorBox, Field, Modal, Open, Panel, ReasonModal, useAction, useLoad } from '../components/ui.jsx';
import { centsToInput, fmtTime, peso, toCents } from '../util.js';

function LockerSearch({ color, label, onUse }) {
  const [n, setN] = useState('');
  const [res, setRes] = useState(null);
  const a = useAction();
  const search = () => a.run(async () => setRes((await api.get(`/daytour/lockers/search?color=${color}&number=${Number(n)}`)).locker));
  const free = res && res.locker_status === 'Available' && !res.assignment;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'end' }}>
        <Field label="Locker number" className="" ><input value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && search()} style={{ width: 120 }} /></Field>
        <button className="btn" onClick={search} disabled={!n}>Search</button>
      </div>
      <ErrorBox error={a.error} />
      {res && (
        <div className={`lockercard ${free ? 'ok' : 'bad'}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b className={`lk-${res.color}`} style={{ fontSize: 16 }}>{res.id}</b><Badge t={free ? 'solid-green' : 'red'}>{res.locker_status.toUpperCase()}</Badge></div>
          <div className="small">Assigned to: {res.assignment ? `${res.assignment.reference} ${res.assignment.group_name}` : '-'}</div>
          <div className="small">Outstanding balance: {peso(res.balance)}</div>
          {res.status_note && <div className="small">Note: {res.status_note}</div>}
          {free ? <button className="btn outline sm" onClick={() => onUse(res.id)}>Use for assignment</button>
            : <div className="small" style={{ color: 'var(--red)', fontWeight: 600 }}>Cannot assign: locker {res.assignment ? 'already in use' : res.locker_status.toLowerCase()}</div>}
        </div>
      )}
      <span className="small muted">{label}</span>
    </div>
  );
}

export default function LockerAssignment() {
  const { id } = useParams();
  const { settings, can } = useAuth();
  const [d, , err, setD] = useLoad(`/daytour/groups/${id}`);
  const [pick, setPick] = useState(null);
  const [type, setType] = useState('Individual');
  const [occ, setOcc] = useState('');
  const [payer, setPayer] = useState('Representative');
  const [modal, setModal] = useState(null);
  const a = useAction();
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const g = d.group;
  const canAssign = g.group_status === 'Arrived / Active' && d.gates.canIssueKeys && can('daytour');
  return (
    <div className="stack">
      <div className="banner">
        <div><div className="big">GROUP {g.reference} &nbsp; {g.group_name}</div></div>
        <div><div className="muted small">Actual guests</div><b>{g.actual_guests}</b></div>
        <div><div className="muted small">Entry charges</div><b style={{ color: d.totals.entryPaid ? '#7fe0b0' : 'var(--gold)' }}>{d.totals.entryPaid ? 'PAID' : g.entry_exception_by ? 'APPROVED TERMS' : 'UNPAID'}</b></div>
        <div><div className="muted small">Lockers issued</div><b>{d.gates.lockersIssued}</b></div>
        <span style={{ flex: 1 }} />
        <div><div className="muted small">Group balance (all lockers)</div><div className="big gold">{peso(d.totals.outstanding)}</div></div>
      </div>
      {!d.gates.canIssueKeys && <div className="err">Key issue is locked until required entry charges are paid, or approved advance-group terms apply. <Link to={`/daytour/${id}`}>Back to group check-in</Link></div>}
      {g.group_status !== 'Arrived / Active' && <div className="note">Group is {g.group_status}. New lockers can only be issued while the group is Arrived / Active.</div>}

      <div className="grid g3">
        <Panel num={1} title="Female locker search (RED, 1-400)"><LockerSearch color="Red" label="Searches the Red keys only. Internal ID RED-001 to RED-400." onUse={setPick} /></Panel>
        <Panel num={2} title="Male locker search (BLUE, 1-400)"><LockerSearch color="Blue" label="Searches the Blue keys only. BLUE-102 and RED-102 are different lockers." onUse={setPick} /></Panel>
        <Panel num={3} title="Assign locker">
          <div className="stack" style={{ gap: 10 }}>
            <div className="seg">{['Individual', 'Shared'].map((t) => <button key={t} type="button" className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === 'Shared' ? 'Shared by several guests' : t}</button>)}</div>
            <Field label="Linked occupants / category counts" hint={<Open id="OD-16" />}><input value={occ} onChange={(e) => setOcc(e.target.value)} placeholder="2 Adults, 1 Child" /></Field>
            <Field label="Who pays this locker"><select value={payer} onChange={(e) => setPayer(e.target.value)}><option>Representative</option><option>Self</option><option>Organizer</option></select></Field>
            <div className="grid g2">
              <Field label="Issue date / time"><input readOnly value="Set by system on assign" /></Field>
              <Field label="Issued by"><input readOnly value="[you]" /></Field>
            </div>
            <button className={`btn gold ${pick && canAssign && occ ? '' : 'locked'}`} disabled={!pick || !canAssign || !occ || a.busy}
              onClick={() => a.run(async () => { const res = await api.post(`/daytour/groups/${id}/lockers`, { locker_id: pick, assignment_type: type, occupants: occ, payer }); setD(res); setPick(null); setOcc(''); })}>
              {pick ? `Assign ${pick} to ${g.reference}` : 'Search and pick a locker'}
            </button>
          </div>
        </Panel>
      </div>
      <ErrorBox error={a.error} />
      <Panel num={4} title={`Group lockers (child accounts of ${g.reference})`}>
        <GroupLockerTable d={d} onAction={(kind, acc) => setModal({ kind, acc })} actions={can('daytour')} />
        <p className="small muted">A payment on one locker lowers that locker and the group. A locker is Available only after key return and full settlement. Lost or faulty locker: unpaid charges transfer to the replacement; the original stays unavailable.</p>
      </Panel>
      <div className="actionbar">
        <Link className="btn outline" to={`/daytour/${id}`}>Back to Check-in</Link>
        <span className="sp" />
        <Link className="btn" to={`/daytour/${id}/settlement`}>Open Group Settlement</Link>
      </div>
      <LockerActionModals modal={modal} setModal={setModal} onDone={setD} settings={settings} />
    </div>
  );
}

export function GroupLockerTable({ d, onAction, actions }) {
  return (
    <div className="tablewrap">
      <table className="tbl">
        <thead><tr><th>Locker ID</th><th>Key</th><th>Type</th><th>Occupants</th><th>Issued</th><th className="right">Balance</th><th>Status</th><th>Key</th>{actions && <th>Row actions</th>}</tr></thead>
        <tbody>
          {d.accounts.map((acc) => (
            <tr key={acc.id}>
              <td><b className={`lk-${acc.color}`}>{acc.locker_id}</b>{acc.history.length > 1 && <div className="small muted">from {acc.history.slice(0, -1).map((h) => h.locker_id).join(', ')}</div>}</td>
              <td>{acc.color === 'Red' ? 'Red / female' : 'Blue / male'}</td><td>{acc.assignment_type}</td><td>{acc.occupants}</td>
              <td>{fmtTime(acc.history[0]?.issued_at)}</td><td className="num">{peso(acc.balance)}</td><td><Badge>{acc.locker_status}</Badge></td><td><Badge>{acc.key}</Badge></td>
              {actions && <td><div className="rowacts">{acc.key === 'Not returned' && <>
                <button className="linkbtn" onClick={() => onAction('transfer', acc)}>Transfer</button>
                <button className="linkbtn red" onClick={() => onAction('lost', acc)}>Lost key</button>
                <button className="linkbtn" onClick={() => onAction('return', acc)}>Return key</button></>}</div></td>}
            </tr>
          ))}
          <tr className="total"><td colSpan={5}>Group balance = group account + sum of locker balances (no double counting)</td><td className="num">{peso(d.totals.outstanding)}</td><td colSpan={actions ? 3 : 2} /></tr>
        </tbody>
      </table>
    </div>
  );
}

export function LockerActionModals({ modal, setModal, onDone, settings }) {
  if (!modal) return null;
  const close = () => setModal(null);
  const { kind, acc } = modal;
  if (kind === 'return') return <ReturnKey acc={acc} onClose={close} onDone={onDone} />;
  if (kind === 'transfer') return (
    <TransferLocker acc={acc} onClose={close} onDone={onDone} />
  );
  if (kind === 'lost') return <LostKey acc={acc} settings={settings} onClose={close} onDone={onDone} />;
  return null;
}

function ReturnKey({ acc, onClose, onDone }) {
  const [id, setId] = useState('');
  const a = useAction();
  return (
    <Modal title={`Return key: ${acc.locker_id}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { onDone(await api.post(`/daytour/locker-accounts/${acc.id}/return-key`, { locker_id: id || acc.locker_id })); onClose(); })}>Record Key Return</button></>}>
      <Field label="Key tag returned (check against the assignment)"><input value={id} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder={acc.locker_id} autoFocus /></Field>
      <div className="note">Balance on this locker: <b>{peso(acc.balance)}</b>. {acc.balance > 0 ? 'A returned but unpaid locker stays unavailable (Key Returned - Unsettled).' : 'Locker becomes Available.'}</div>
      <ErrorBox error={a.error} />
    </Modal>
  );
}

function TransferLocker({ acc, onClose, onDone }) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const a = useAction();
  return (
    <Modal title={`Faulty locker: move from ${acc.locker_id}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={!to || !note || a.busy} onClick={() => a.run(async () => { onDone(await api.post(`/daytour/locker-accounts/${acc.id}/transfer`, { to_locker_id: to, note })); onClose(); })}>Transfer</button></>}>
      <Field label="Replacement locker ID"><input value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} placeholder={acc.color === 'Red' ? 'RED-020' : 'BLUE-020'} /></Field>
      <Field label="Fault description"><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="note">The original locker becomes Under Repair. All unpaid charges ({peso(acc.balance)}) move with the account. A transfer is not a new sale.</div>
      <ErrorBox error={a.error} />
    </Modal>
  );
}

function LostKey({ acc, settings, onClose, onDone }) {
  const [pen, setPen] = useState(centsToInput(settings.lost_key_penalty_min));
  const [note, setNote] = useState('Key not returned');
  const a = useAction();
  return (
    <Modal title={`Lost key: ${acc.locker_id}`} onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn danger" disabled={a.busy} onClick={() => a.run(async () => { onDone(await api.post(`/daytour/locker-accounts/${acc.id}/lost-key`, { penalty: toCents(pen), note })); onClose(); })}>Add Penalty and Mark Locker Lost</button></>}>
      <div className="grid g2">
        <Field label={`Penalty (${peso(settings.lost_key_penalty_min)} to ${peso(settings.lost_key_penalty_max)})`} hint={<Open id="OD-14" />}><input className="num" value={pen} onChange={(e) => setPen(e.target.value)} /></Field>
        <Field label="Incident note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="note">The penalty is charged to this locker account and paid like any other charge. The locker stays unavailable until the security or replacement decision.</div>
      <ErrorBox error={a.error} />
    </Modal>
  );
}

export { ReasonModal };
