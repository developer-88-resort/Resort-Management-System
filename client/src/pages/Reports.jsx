// Operational & management reports built from source transactions. (Full Phase 5 reporting is not yet designed.)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, ErrorBox, Field, Panel, useLoad } from '../components/ui.jsx';
import { localToday, peso, pesoSigned } from '../util.js';

const T = ({ head, rows }) => (
  <table className="tbl"><thead><tr>{head.map((h, i) => <th key={h} className={i === head.length - 1 ? 'right' : ''}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === r.length - 1 ? 'num' : ''}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} className="muted">No data.</td></tr>}</tbody></table>
);

export default function Reports() {
  const [from, setFrom] = useState(localToday());
  const [to, setTo] = useState(localToday());
  const [d, , err] = useLoad(`/reports/summary?from=${from}&to=${to}`);
  const total = (d?.byMethod || []).reduce((s, x) => s + x.amount, 0);
  return (
    <div className="stack">
      <div className="pagehead"><h1>Reports</h1><span className="sp" />
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn outline" onClick={() => window.print()}>Print</button>
      </div>
      <ErrorBox error={err} />
      {d && (
        <div className="grid g2">
          <Panel title={`Collections by tender method (total ${peso(total)})`}><T head={['Method', 'Payments', 'Amount']} rows={d.byMethod.map((x) => [x.method, x.payments, pesoSigned(x.amount)])} /></Panel>
          <Panel title="Collections by cashier"><T head={['Cashier', 'Payments', 'Amount']} rows={d.byCashier.map((x) => [x.cashier, x.payments, pesoSigned(x.amount)])} /></Panel>
          <Panel title="Collections by purpose"><T head={['Account', 'Purpose', 'Payments', 'Amount']} rows={d.byPurpose.map((x) => [x.account_type, x.purpose, x.payments, pesoSigned(x.amount)])} /></Panel>
          <Panel title="Department sales & charges"><T head={['Department', 'Method', 'Txns', 'Amount']} rows={d.dept.map((x) => [x.department, x.method === 'direct' ? 'Direct (dept receipt)' : 'Charged to account', x.txns, peso(x.amount)])} /></Panel>
          <Panel title={`Day Tour headcount (${d.groups.groups || 0} groups, ${d.groups.guests || 0} guests)`}><T head={['Category', 'Count', 'Entrance']} rows={d.daytour.map((x) => [x.category_name, x.count, peso(x.amount)])} /></Panel>
          <Panel title="Reservations created by source"><T head={['Source', 'Count']} rows={d.reservationsMade.map((x) => [x.source, x.count])} /><p className="small muted">Cancellations in period: {d.cancellations}</p></Panel>
          <Panel title="Room transfers"><T head={['Treatment', 'Count', 'Upgrade value']} rows={d.transfers.map((x) => [x.treatment, x.count, peso(x.value)])} /></Panel>
          <Panel title="Discounts & locker incidents">
            <T head={['Discount', 'Lines', 'Amount']} rows={d.discounts.map((x) => [x.category, x.lines, peso(x.amount)])} />
            <div style={{ height: 10 }} />
            <T head={['Incident', 'Count', 'Penalties']} rows={d.lockerIncidents.map((x) => [x.type, x.count, peso(x.penalty)])} />
          </Panel>
          <Panel title="Open room folios (current)"><T head={['Reservation', 'Guest', 'Status', 'Outstanding']} rows={d.openFolios.map((x) => [<Link key={x.id} to={`/reservations/${x.id}`}>{x.reference}</Link>, x.full_name, <Badge key="b">{x.reservation_status}</Badge>, pesoSigned(x.outstanding)])} /></Panel>
          <Panel title="Day Tour groups on site (current)"><T head={['Group', 'Name', 'Status', 'Outstanding']} rows={d.openGroups.map((x) => [<Link key={x.id} to={`/daytour/${x.id}`}>{x.reference}</Link>, x.group_name, <Badge key="b">{x.group_status}</Badge>, peso(x.outstanding)])} /></Panel>
        </div>
      )}
    </div>
  );
}
