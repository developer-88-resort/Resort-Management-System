// Day Tour cashier screen (Part 2, Fig. 4): group, guest counts, facility charges, payment, entry lock.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ApprovalFields, Badge, ErrorBox, Field, Modal, Open, Panel, Proposed, ReasonModal, TenderEntry, useAction, useLoad } from '../components/ui.jsx';
import { Icon } from '../components/Design.jsx';
import { centsToInput, fmtDate, fmtDateTime, localToday, peso, toCents } from '../util.js';

export default function GroupCheckIn() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, can } = useAuth();
  const [d, setD] = useState(null);
  const [rates, setRates] = useState([]);
  const [info, setInfo] = useState({ booking_type: 'Walk-in', group_name: '', contact_no: '', arrival_date: localToday(), estimated_guests: '', rate_basis: settings.daytour_rate_bases?.[0], agreement_ref: '', payment_terms: settings.daytour_payment_terms?.[0], remarks: '' });
  const [counts, setCounts] = useState({});
  const [overrides, setOverrides] = useState({});
  const [facility, setFacility] = useState({ code: '', qty: 1 });
  const [modal, setModal] = useState(null);
  const [paid, setPaid] = useState(null);
  const a = useAction();

  const load = async (gid = id) => {
    const res = await api.get(`/daytour/groups/${gid}`);
    apply(res);
  };
  const apply = (res) => {
    setD(res);
    const g = res.group;
    setInfo({ booking_type: g.booking_type, group_name: g.group_name, contact_no: g.contact_no || '', arrival_date: g.arrival_date, estimated_guests: g.estimated_guests, rate_basis: g.rate_basis, agreement_ref: g.agreement_ref || '', payment_terms: g.payment_terms, remarks: g.remarks || '' });
    const c = {}; const o = {};
    for (const x of res.counts) { c[x.category_code] = x.count; if (x.rate_override_by) o[x.category_code] = centsToInput(x.rate); }
    setCounts(c); setOverrides(o);
  };
  useEffect(() => { if (id) load().catch(a.setError); else setD(null); }, [id]); // eslint-disable-line
  const arrival = d?.group.arrival_date || info.arrival_date;
  useEffect(() => { api.get(`/daytour/rates?date=${arrival}`).then((r) => setRates(r.rates)).catch(a.setError); }, [arrival]); // eslint-disable-line

  const g = d?.group;
  const guestRates = rates.filter((r) => r.kind === 'guest');
  const facRates = rates.filter((r) => r.kind === 'facility');
  const special = info.rate_basis !== 'Standard walk-in rates';
  const rateOf = (r) => (overrides[r.code] !== undefined && overrides[r.code] !== '' ? toCents(overrides[r.code]) : r.amount);
  const persons = guestRates.filter((r) => r.counts_as_person).reduce((s, r) => s + (Number(counts[r.code]) || 0), 0);
  const entrance = guestRates.reduce((s, r) => s + (Number(counts[r.code]) || 0) * rateOf(r), 0);
  const editableCounts = !g || ['Advance Booking', 'Arrived / Active'].includes(g.group_status);
  const canActivate = !g || g.group_status === 'Advance Booking' ? (!g || g.arrival_date === localToday()) : g.group_status === 'Arrived / Active';
  const active = g && ['Arrived / Active', 'Settling'].includes(g.group_status);

  const saveGroup = () => a.run(async () => {
    const body = { ...info, estimated_guests: Number(info.estimated_guests) || 0 };
    const res = g ? await api.put(`/daytour/groups/${g.id}`, body) : await api.post('/daytour/groups', body);
    apply(res);
    if (!g) nav(`/daytour/${res.group.id}`, { replace: true });
    return res;
  });
  const activate = () => a.run(async () => {
    let gid = g?.id;
    if (!gid) { const res = await api.post('/daytour/groups', { ...info, estimated_guests: Number(info.estimated_guests) || 0 }); gid = res.group.id; }
    const ov = {};
    for (const [k, v] of Object.entries(overrides)) if (v !== '') ov[k] = toCents(v);
    const body = { counts: Object.fromEntries(guestRates.map((r) => [r.code, Number(counts[r.code]) || 0])), rate_overrides: special ? ov : {} };
    if (special && Object.keys(ov).length && !modal?.approval) { setModal({ approve: { gid, body } }); return; }
    const res = await api.post(`/daytour/groups/${gid}/counts`, body);
    apply(res);
    if (!g) nav(`/daytour/${gid}`, { replace: true });
  });

  return (
    <div className="stack group-checkin">
      <div className="pagehead group-checkin-heading"><h1>{g ? 'Group Check-in' : 'New Group Check-in'}</h1><span className="sp" />{!g && <button className="btn outline" onClick={() => setModal('find')}><Icon name="search" size={17} />Find Advance Booking</button>}</div>
      {g && (
        <div className="banner group-status-banner">
          <div><div className="muted small">Group</div><div className="big">{g.reference} · {g.group_name}</div></div>
          <Badge>{g.group_status}</Badge>
          <span style={{ flex: 1 }} />
          <div><div className="muted small">Group balance (all accounts)</div><div className="big gold">{peso(d.totals.outstanding)}</div></div>
          {active && <Link className="btn outline" to={`/daytour/${g.id}/lockers`}>Lockers</Link>}
          {active && <Link className="btn gold" to={`/daytour/${g.id}/settlement`}>Settlement & Key Return</Link>}
        </div>
      )}
      {g?.group_status === 'Advance Booking' && g.arrival_date !== localToday() && <div className="note teal">Advance booking for {fmtDate(g.arrival_date)}. Only organizer, contact, arrival date and estimated guests are kept until arrival. Activate the group on arrival day.</div>}
      {g?.group_status === 'Cancelled' && <div className="note red">Cancelled by {g.cancelled_by} {fmtDateTime(g.cancelled_at)}: {g.cancel_reason}. History is kept.</div>}
      {g && ['Cancelled', 'Checked Out'].includes(g.group_status) && (g.refund_decision || d.totals.outstanding < 0) && (
        <div className="note">
          {g.refund_decision
            ? <>Deposit decision: <b>{g.refund_decision}</b> ({g.refund_note}, approved by {g.refund_approver}).</>
            : <>Deposit / credit of <b>{peso(-d.totals.outstanding)}</b> awaits a refund or forfeit decision <Open id="OD-03" />. {can('daytour') && <button className="btn sm" onClick={() => setModal('refund')}>Refund decision…</button>}</>}
        </div>
      )}
      {g?.group_status === 'Checked Out' && <div className="okmsg">Group checked out {fmtDateTime(g.checked_out_at)}. All charges settled and keys returned or cleared.</div>}

      <div className="group-checkin-layout">
        <Panel num={1} title="Group information" className="group-info">
          <div className="stack" style={{ gap: 10 }}>
            <div className="grid g2 group-identity-row" style={{ alignItems: 'end' }}>
              <Field label="Group Reference"><input readOnly value={g?.reference || 'DT-____ (auto)'} /></Field>
              <Field label="Booking Type">
                <div className="seg">{['Walk-in', 'Advance'].map((t) => <button key={t} type="button" disabled={!!g} className={info.booking_type === t ? 'on' : ''} onClick={() => setInfo({ ...info, booking_type: t, arrival_date: t === 'Walk-in' ? localToday() : info.arrival_date })}>{t}</button>)}</div>
              </Field>
            </div>
            <Field label="Group / Organizer Name"><input value={info.group_name} onChange={(e) => setInfo({ ...info, group_name: e.target.value })} placeholder="Group or organizer name" autoComplete="name" /></Field>
            <div className="grid g2">
              <Field label="Contact Number"><input placeholder="e.g. 0917 000 0000" autoComplete="tel" value={info.contact_no} onChange={(e) => setInfo({ ...info, contact_no: e.target.value })} /></Field>
              <Field label="Arrival Date"><input type="date" value={info.arrival_date} min={localToday()} disabled={info.booking_type === 'Walk-in' || (g && g.group_status !== 'Advance Booking')} onChange={(e) => setInfo({ ...info, arrival_date: e.target.value })} /></Field>
              <Field label="Estimated Guests (booked)"><input type="number" min={0} className="num" value={info.estimated_guests} onChange={(e) => setInfo({ ...info, estimated_guests: e.target.value })} /></Field>
              <Field label="Actual Guests (counted)"><input readOnly className="num watch" value={persons} /></Field>
            </div>
            <Field label="Rate Basis"><select value={info.rate_basis} disabled={g && g.group_status !== 'Advance Booking'} onChange={(e) => setInfo({ ...info, rate_basis: e.target.value })}>{(settings.daytour_rate_bases || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Agreement / Approval Reference" hint={<Open id="OD-07, 08" />}><input value={info.agreement_ref} onChange={(e) => setInfo({ ...info, agreement_ref: e.target.value })} placeholder={special ? 'Required for special rate' : 'Optional'} /></Field>
            <Field label="Payment Terms"><select value={info.payment_terms} onChange={(e) => setInfo({ ...info, payment_terms: e.target.value })}>{(settings.daytour_payment_terms || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
            <div className="row group-save-actions">
              <button className="btn outline" disabled={a.busy || (g && !['Advance Booking', 'Arrived / Active', 'Settling'].includes(g.group_status))} onClick={saveGroup}>{g ? 'Save Group' : info.booking_type === 'Advance' ? 'Save Advance Booking' : 'Save Group'}</button>
              {g?.group_status === 'Advance Booking' && <button className="btn danger" onClick={() => setModal('cancel')}>Cancel booking</button>}
            </div>
            <p className="small muted">Estimates and actual counts are separate. Special rates require approval; tax-withholding details are stored separately <Open id="OD-07" />.</p>
          </div>
        </Panel>

        <div className="stack group-operations">
          <Panel num={2} title="Guest counts and entrance" className="group-entrance" right={<span className="group-guest-count"><Icon name="people" size={15} />{persons} guests</span>}>
            <div className="tablewrap"><table className="tbl group-count-table">
              <thead><tr><th>Category</th><th style={{ width: 110 }}>Count</th><th className="right" style={{ width: 140 }}>Rate</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {guestRates.map((r) => (
                  <tr key={r.code}><td><div className="entrance-category"><span className="entrance-category-icon"><Icon name={r.counts_as_person ? 'people' : 'sun'} size={19} /></span><div><strong>{r.name}</strong>{!r.counts_as_person && <span className="small muted">Not counted as guest</span>}</div></div></td>
                    <td><input type="number" min={0} aria-label={`Count for ${r.name}`} placeholder="0" className="num" disabled={!editableCounts} value={counts[r.code] ?? ''} onChange={(e) => setCounts({ ...counts, [r.code]: e.target.value })} /></td>
                    <td className="num">{special && editableCounts
                      ? <input aria-label={`Rate for ${r.name}`} className="num" placeholder={centsToInput(r.amount)} value={overrides[r.code] ?? ''} onChange={(e) => setOverrides({ ...overrides, [r.code]: e.target.value })} />
                      : <span className="entrance-rate">{peso(rateOf(r))}</span>}</td>
                    <td className="num">{peso((Number(counts[r.code]) || 0) * rateOf(r))}</td></tr>
                ))}
                <tr className="total"><td>Actual guests (persons)</td><td className="num">{persons}</td><td /><td className="num">{peso(entrance)}</td></tr>
              </tbody>
            </table></div>
            <p className="open small entrance-discount-note">Senior / PWD: ID check required to claim a discount; the amount is calculated by the approved formula, not shown here (OD-09, 10, 12).</p>
            <div className="row entrance-actions">
              <span className="small muted" style={{ flex: 1 }}>Rates come from the configured table (effective date, reason, approver). {special && 'Special-rate overrides need supervisor approval.'}</span>
              {editableCounts && can('daytour') && <button className="btn gold" disabled={a.busy || !canActivate || !persons || !info.group_name} onClick={activate}>{!g || g.group_status === 'Advance Booking' ? 'Activate Group' : 'Update counts'}</button>}
            </div>
            {!canActivate && g?.group_status === 'Advance Booking' && <p className="small open">This group can be activated on {fmtDate(g.arrival_date)}.</p>}
          </Panel>

          {g && (
            <div className="grid g2 group-financials">
              <Panel num={3} title="Facility charges" className="group-facilities">
                <table className="tbl"><thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Rate</th><th className="right">Amount</th><th /></tr></thead>
                  <tbody>
                    {d.charges.filter((c) => c.kind === 'facility' || c.reverses_id).map((c) => {
                      const voided = d.charges.some((x) => x.reverses_id === c.id);
                      return <tr key={c.id} className={voided ? 'dim' : ''}><td>{c.description}</td><td className="num">{c.qty}</td><td className="num">{peso(c.rate)}</td><td className="num">{peso(c.amount)}</td>
                        <td>{!c.reverses_id && !voided && can('daytour') && <button className="linkbtn red" onClick={() => setModal({ void: c })}>void</button>}</td></tr>;
                    })}
                  </tbody></table>
                {active && can('daytour') && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <select value={facility.code} onChange={(e) => setFacility({ ...facility, code: e.target.value })} style={{ flex: 1 }}>
                      <option value="">Kubo / Cottage…</option>{facRates.map((r) => <option key={r.code} value={r.code}>{r.name} - {peso(r.amount)}</option>)}
                    </select>
                    <input type="number" min={1} value={facility.qty} onChange={(e) => setFacility({ ...facility, qty: e.target.value })} style={{ width: 70 }} />
                    <button className="btn outline" disabled={!facility.code} onClick={() => a.run(async () => apply(await api.post(`/daytour/groups/${g.id}/facilities`, { code: facility.code, qty: Number(facility.qty) })))}>+ Add Facility</button>
                  </div>
                )}
                <p className="small muted">A charge item, not a guest category. Not discountable until confirmed <Open id="OD-06" />.</p>
              </Panel>
              <Panel num={4} title="Charges and payment" className="group-payment">
                <div className="kv">
                  <span>Entrance subtotal</span><span>{peso(d.totals.entrance)}</span>
                  <span>Facility subtotal</span><span>{peso(d.totals.facility)}</span>
                  {d.totals.groupDept > 0 && <><span>Group restaurant bills</span><span>{peso(d.totals.groupDept)}</span></>}
                  <b>TOTAL DUE (group account)</b><b>{peso(d.totals.entryCharges + d.totals.groupDept + d.totals.otherGroup)}</b>
                  <span>Paid to date</span><span>{peso(d.totals.groupPaid)}</span>
                  <b className="group-balance-label">Balance</b><b className="watch group-balance-value">{peso(d.totals.groupAccountBalance)}</b>
                </div>
                <div className="hr" />
                {g.group_status === 'Advance Booking' && d.advance && (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="kv">
                      <span>Estimate ({g.estimated_guests} x Regular Adult {peso(d.advance.rate)})</span><span>{peso(d.advance.estimate)}</span>
                      <span>Advance received</span><span>{peso(d.advance.paid)}</span>
                      <b>Remaining on estimate</b><b>{peso(d.advance.remaining)}</b>
                    </div>
                    {d.advance.allowed
                      ? d.advance.remaining > 0 && can('daytour') && <TenderEntry due={d.advance.remaining} buttons busy={a.busy} submitLabel="Record Advance Payment"
                          onSubmit={(tenders) => a.run(async () => { const res = await api.post(`/daytour/groups/${g.id}/payments`, { tenders }); apply(res); setPaid(res.payment); return res; })} />
                      : <p className="small muted">Payment terms are {g.payment_terms}. Choose Down payment or Full advance and Save Group to take an advance.</p>}
                    <p className="small muted">The advance is held on the group account and used against the entrance charges when actual counts are recorded on arrival.</p>
                  </div>
                )}
                {d.totals.groupAccountBalance < 0 && <div className="note teal">Credit on the group account: {peso(-d.totals.groupAccountBalance)} (advance larger than charges). Refund or use is a management decision <Open id="OD-03" />.</div>}
                {d.totals.groupAccountBalance > 0 && active && can('daytour')
                  ? <TenderEntry due={d.totals.groupAccountBalance} buttons busy={a.busy} onSubmit={(tenders) => a.run(async () => { const res = await api.post(`/daytour/groups/${g.id}/payments`, { tenders }); apply(res); setPaid(res.payment); return res; })} />
                  : d.totals.groupAccountBalance <= 0 && g.group_status !== 'Advance Booking' && <div className="okmsg">Group account paid.</div>}
                {paid && <div className="okmsg" style={{ marginTop: 8 }}>{paid.payment_no} recorded. <Link to={`/receipt/${paid.id}`}>Print receipt {paid.receipt?.receipt_no}</Link></div>}
                <div className="note" style={{ marginTop: 10 }}>Key issue and entry stay locked until required entry charges are paid, except approved advance-group terms.
                  {g.entry_exception_by ? <div><b>Approved exception:</b> {g.entry_exception_reason} ({g.entry_exception_by})</div>
                    : !d.totals.entryPaid && active && <div style={{ marginTop: 6 }}><button className="btn sm outline" onClick={() => setModal('exception')}>Approve advance-group terms…</button></div>}
                </div>
                {d.discounts.length > 0 && (
                  <table className="tbl" style={{ marginTop: 8 }}><tbody>{d.discounts.map((x) => (
                    <tr key={x.id}><td className="small">Less: {x.category}{x.target_type === 'locker_account' ? ' (locker)' : ''} {x.id_verified ? '· ID verified' : ''} · {x.approver}</td><td className="num">({peso(x.amount)})</td></tr>
                  ))}</tbody></table>
                )}
                {active && can('daytour') && <button className="btn sm outline" style={{ marginTop: 8 }} onClick={() => setModal('discount')}>Add approved discount (Senior / PWD)…</button>}
                <p className="small open">Official document type: OD-13.</p>
              </Panel>
            </div>
          )}
        </div>
      </div>
      <ErrorBox error={a.error} />
      {g && (
        <div className="actionbar group-locker-action">
          <span className="small">{d.gates.canIssueKeys ? '☑ Entry charges paid' : '☐ Entry charges not yet paid'}</span>
          <span className="small muted">Continue is locked while any required entry charge is unpaid. <Proposed /></span>
          <span className="sp" />
          <button className={`btn gold ${d.gates.canIssueKeys && active ? '' : 'locked'}`} disabled={!d.gates.canIssueKeys || !active} onClick={() => nav(`/daytour/${g.id}/lockers`)}>Continue to Locker Assignment</button>
        </div>
      )}

      {modal === 'cancel' && <ReasonModal title="Cancel advance booking" danger label="Cancellation reason" submitLabel="Cancel booking" onClose={() => setModal(null)}
        onSubmit={async ({ reason }) => apply(await api.post(`/daytour/groups/${g.id}/cancel`, { reason }))}><div className="note">History is kept. Deposit treatment follows management rules <Open id="OD-03" />.</div></ReasonModal>}
      {modal === 'exception' && <ReasonModal title="Allow entry before payment" needsApproval label="Reason / agreement reference" onClose={() => setModal(null)}
        onSubmit={async ({ reason, approval }) => apply(await api.post(`/daytour/groups/${g.id}/entry-exception`, { reason, approval }))} />}
      {modal?.void && <ReasonModal title={`Void ${modal.void.description}`} needsApproval danger submitLabel="Void (post reversal)" onClose={() => setModal(null)}
        onSubmit={async ({ reason, approval }) => apply(await api.post(`/daytour/groups/${g.id}/charges/${modal.void.id}/void`, { reason, approval }))} />}
      {modal === 'refund' && <GroupRefund d={d} onClose={() => setModal(null)} onDone={(res) => { apply(res); setModal(null); }} />}
      {modal === 'find' && <FindAdvance onClose={() => setModal(null)} onPick={(gid) => { setModal(null); nav(`/daytour/${gid}`); }} />}
      {modal === 'discount' && <GroupDiscount d={d} onClose={() => setModal(null)} onDone={(res) => { apply(res); setModal(null); }} />}
      {modal?.approve && <ApproveRates m={modal.approve} onClose={() => setModal(null)} onDone={(res) => { apply(res); setModal(null); if (!g) nav(`/daytour/${res.group.id}`, { replace: true }); }} />}
    </div>
  );
}

function ApproveRates({ m, onClose, onDone }) {
  const [approval, setApproval] = useState({});
  const a = useAction();
  return (
    <Modal title="Approve special rates" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => onDone(await api.post(`/daytour/groups/${m.gid}/counts`, { ...m.body, approval })))}>Approve & activate</button></>}>
      <div className="note">Special rates differ from the configured table. A supervisor must authorize them. The approver is stored with each rate.</div>
      <ApprovalFields value={approval} onChange={setApproval} />
      <ErrorBox error={a.error} />
    </Modal>
  );
}

/** Find Advance Booking (Part 2 Fig. 4 panel 1): an advance booking holds organizer, contact, arrival date and estimate until arrival. */
function FindAdvance({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [d] = useLoad(`/daytour/groups?status=${encodeURIComponent('Advance Booking')}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <Modal title="Find Advance Booking" onClose={onClose} wide>
      <Field label="Organizer, group name, reference or contact"><input value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
      <table className="tbl">
        <thead><tr><th>Reference</th><th>Group / organizer</th><th>Contact</th><th>Arrival</th><th className="right">Estimated</th><th>Terms</th><th className="right">Advance paid</th></tr></thead>
        <tbody>{(d?.groups || []).map((g) => (
          <tr key={g.id} className="click" onClick={() => onPick(g.id)}>
            <td><b>{g.reference}</b></td><td>{g.group_name}</td><td>{g.contact_no}</td>
            <td style={{ color: g.arrival_date === localToday() ? 'var(--green)' : undefined, fontWeight: g.arrival_date === localToday() ? 700 : 400 }}>{fmtDate(g.arrival_date)}</td>
            <td className="num">{g.estimated_guests}</td><td className="small">{g.payment_terms}</td><td className="num">{peso(g.totals.groupPaid)}</td>
          </tr>
        ))}{d && !d.groups.length && <tr><td colSpan={7} className="muted">No advance booking found.</td></tr>}</tbody>
      </table>
    </Modal>
  );
}

/** Approved discount line. Senior / PWD: ID check first; amount follows the approved formula (OD-09, 10, 12). */
function GroupDiscount({ d, onClose, onDone }) {
  const { settings } = useAuth();
  const [f, setF] = useState({ target: 'group', category: settings.discount_categories?.[0] || 'Senior Citizen', amount: '', basis: '', vat_treatment: '', reason: '', id_verified: false });
  const [approval, setApproval] = useState({});
  const a = useAction();
  return (
    <Modal title="Add approved discount" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => onDone(await api.post(`/daytour/groups/${d.group.id}/discounts`, {
        target_type: f.target === 'group' ? 'group' : 'locker_account', target_id: f.target === 'group' ? d.group.id : Number(f.target),
        category: f.category, amount: toCents(f.amount), basis: f.basis, vat_treatment: f.vat_treatment, reason: f.reason, id_verified: f.id_verified, approval })))}>Add discount</button></>}>
      <div className="note">A discount claim needs ID verification and the approved formula, which is still being decided <Open id="OD-09, 10, 12" />. Enter the computed amount and its basis. The original charge stays as its own line.</div>
      <div className="grid g2">
        <Field label="Account"><select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
          <option value="group">Group account (entrance / facilities)</option>
          {d.accounts.map((x) => <option key={x.id} value={x.id}>Locker {x.locker_id}</option>)}
        </select></Field>
        <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(settings.discount_categories || []).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Discount amount"><input className="num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Basis (eligible items / computation)"><input value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} /></Field>
        <Field label="VAT treatment"><input value={f.vat_treatment} onChange={(e) => setF({ ...f, vat_treatment: e.target.value })} /></Field>
        <Field label="ID number / reason"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.id_verified} onChange={(e) => setF({ ...f, id_verified: e.target.checked })} /> Senior Citizen / PWD ID checked against the guest</label>
      <ApprovalFields value={approval} onChange={setApproval} />
      <ErrorBox error={a.error} />
    </Modal>
  );
}

/** Deposit treatment for a cancelled group (or a credit after checkout): refund or forfeit, with supervisor approval (OD-03 pattern). */
function GroupRefund({ d, onClose, onDone }) {
  const { settings } = useAuth();
  const credit = -d.totals.outstanding;
  const [decision, setDecision] = useState('No Refund');
  const [amount, setAmount] = useState(centsToInput(credit));
  const [method, setMethod] = useState(settings.payment_methods?.[0]);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState({});
  const a = useAction();
  return (
    <Modal title="Deposit refund / forfeit decision" onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Back</button>
      <button className="btn" disabled={a.busy || !reason} onClick={() => a.run(async () => onDone(await api.post(`/daytour/groups/${d.group.id}/refund-decision`, { decision, amount: toCents(amount), method, reference, reason, approval })))}>Record decision</button></>}>
      <div className="note">Deposit treatment follows management rules <Open id="OD-03" />. Deposit / credit held: <b>{peso(credit)}</b>.</div>
      <div className="seg">{['No Refund', 'Refund Completed'].map((x) => <button key={x} type="button" className={decision === x ? 'on' : ''} onClick={() => setDecision(x)}>{x === 'No Refund' ? 'Forfeit (no refund)' : 'Refund paid out'}</button>)}</div>
      {decision === 'Refund Completed' && (
        <div className="grid g3">
          <Field label="Refund amount"><input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Paid out by"><select value={method} onChange={(e) => setMethod(e.target.value)}>{settings.payment_methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Reason (required)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ApprovalFields value={approval} onChange={setApproval} />
      <ErrorBox error={a.error} />
    </Modal>
  );
}
