// Operational & management reports built from source transactions. (Full Phase 5 reporting is not yet designed.)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, ErrorBox, Field, Panel, useLoad } from '../components/ui.jsx';
import { Icon } from '../components/Design.jsx';
import { fmtDate, localToday, peso, pesoSigned } from '../util.js';

const T = ({ head, rows, empty = 'No data for this period.' }) => (
  <div className="tablewrap"><table className="tbl report-table"><thead><tr>{head.map((h, i) => <th key={h} className={i === head.length - 1 ? 'right' : ''}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === r.length - 1 ? 'num' : ''}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} className="muted">{empty}</td></tr>}</tbody></table></div>
);

export default function Reports() {
  const [from, setFrom] = useState(localToday());
  const [to, setTo] = useState(localToday());
  const [d, , err] = useLoad(`/reports/summary?from=${from}&to=${to}`);
  const total = (d?.byMethod || []).reduce((s, x) => s + x.amount, 0);
  return (
    <div className="stack reports-workspace">
      <div className="pagehead reports-heading"><h1>Reports</h1><span className="sp" /><button className="btn outline report-print" onClick={() => window.print()}><Icon name="print" size={17} />Print</button></div>
      <div className="reports-print-heading"><h1>Reports</h1><p>{fmtDate(from)} - {fmtDate(to)}</p></div>
      <div className="report-filters noprint"><span className="report-filter-icon"><Icon name="calendar" size={22} /></span>
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <span className="report-period-label">Reporting period</span>
      </div>
      <ErrorBox error={err} />
      {d && (
        <>
        <div className="report-metrics">
          <div className="report-metric report-collected"><div><span>Collections</span><strong>{peso(total)}</strong></div><span className="report-metric-icon"><Icon name="wallet" size={22} /></span></div>
          <div className="report-metric"><div><span>Day Tour groups</span><strong>{d.groups.groups || 0}</strong></div><span className="report-metric-icon"><Icon name="people" size={22} /></span></div>
          <div className="report-metric"><div><span>Day Tour guests</span><strong>{d.groups.guests || 0}</strong></div><span className="report-metric-icon"><Icon name="sun" size={22} /></span></div>
          <div className="report-metric report-cancellations"><div><span>Cancellations</span><strong>{d.cancellations}</strong></div><span className="report-metric-icon"><Icon name="calendar" size={22} /></span></div>
        </div>
        <div className="grid g2 report-grid">
          <Panel title="Collections by tender method" right={<Icon name="wallet" size={18} />}><T head={['Method', 'Payments', 'Amount']} rows={d.byMethod.map((x) => [x.method, x.payments, pesoSigned(x.amount)])} /></Panel>
          <Panel title="Collections by cashier" right={<Icon name="people" size={18} />}><T head={['Cashier', 'Payments', 'Amount']} rows={d.byCashier.map((x) => [x.cashier, x.payments, pesoSigned(x.amount)])} /></Panel>
          <Panel title="Collections by purpose"><T head={['Account', 'Purpose', 'Payments', 'Amount']} rows={d.byPurpose.map((x) => [x.account_type, x.purpose, x.payments, pesoSigned(x.amount)])} /></Panel>
          <Panel title="Department sales & charges"><T head={['Department', 'Method', 'Txns', 'Amount']} rows={d.dept.map((x) => [x.department, x.method === 'direct' ? 'Direct (dept receipt)' : 'Charged to account', x.txns, peso(x.amount)])} /></Panel>
          <Panel title="Day Tour headcount"><T head={['Category', 'Count', 'Entrance']} rows={d.daytour.map((x) => [x.category_name, x.count, peso(x.amount)])} /></Panel>
          <Panel title="Reservations created by source"><T head={['Source', 'Count']} rows={d.reservationsMade.map((x) => [x.source, x.count])} /></Panel>
          <Panel title="Room transfers"><T head={['Treatment', 'Count', 'Upgrade value']} rows={d.transfers.map((x) => [x.treatment, x.count, peso(x.value)])} /></Panel>
          <Panel title="Discounts & locker incidents">
            <T head={['Discount', 'Lines', 'Amount']} rows={d.discounts.map((x) => [x.category, x.lines, peso(x.amount)])} />
            <div style={{ height: 10 }} />
            <T head={['Incident', 'Count', 'Penalties']} rows={d.lockerIncidents.map((x) => [x.type, x.count, peso(x.penalty)])} />
          </Panel>
        </div>
        <div className="report-current-heading"><h2>Current accounts</h2></div>
        <div className="grid g2 report-grid report-current">
          <Panel title="Open room folios (current)"><T empty="No open room folios." head={['Reservation', 'Guest', 'Status', 'Outstanding']} rows={d.openFolios.map((x) => [<Link key={x.id} to={`/reservations/${x.id}`}>{x.reference}</Link>, x.full_name, <Badge key="b">{x.reservation_status}</Badge>, pesoSigned(x.outstanding)])} /></Panel>
          <Panel title="Day Tour groups on site (current)"><T empty="No groups on site." head={['Group', 'Name', 'Status', 'Outstanding']} rows={d.openGroups.map((x) => [<Link key={x.id} to={`/daytour/${x.id}`}>{x.reference}</Link>, x.group_name, <Badge key="b">{x.group_status}</Badge>, peso(x.outstanding)])} /></Panel>
        </div>
        </>
      )}
    </div>
  );
}
