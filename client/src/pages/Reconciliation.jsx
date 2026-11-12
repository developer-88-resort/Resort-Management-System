import { Icon } from '../components/Design.jsx';
// Daily reconciliation during parallel running (Part 1 Fixed decision 9; Part 3 s5 phase 4).
// IRMS figures come from source transactions. Type the matching figure from the old system / department POS,
// explain every variance, and save the signed-off sheet.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, Panel, useAction, useLoad } from '../components/ui.jsx';
import { fmtDateTime, localToday, peso, pesoSigned, toCents } from '../util.js';

export default function Reconciliation() {
  const [date, setDate] = useState(localToday());
  const [d, reload, err] = useLoad(`/reports/reconciliation?date=${date}`);
  const [ext, setExt] = useState({});
  const [notes, setNotes] = useState({});
  const [overall, setOverall] = useState('');
  const [saved, setSaved] = useState(false);
  const a = useAction();
  useEffect(() => { setExt({}); setNotes({}); setOverall(''); setSaved(false); }, [date]);
  const groups = {};
  for (const l of d?.lines || []) (groups[l.group] ||= []).push(l);
  const variance = (l) => (ext[l.key] === undefined || ext[l.key] === '' ? null : l.system - toCents(ext[l.key]));
  const total = (d?.lines || []).reduce((s, l) => s + Math.abs(variance(l) || 0), 0);
  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Daily Reconciliation</h1>
        <Field label=""><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <span className="sp" /><button className="btn outline" onClick={() => window.print()}><Icon name="print" size={16} />Print</button>
      </div>
      <div className="note">During any parallel period each transaction type has one system of record, and nothing is recorded in both. Compare IRMS with the old system (WinCloud) and each department POS every day. A variance needs a note.</div>
      <ErrorBox error={err || a.error} />
      {saved && <div className="okmsg">Reconciliation saved.</div>}
      <div className="grid g2">
        {Object.entries(groups).map(([g, lines]) => (
          <Panel key={g} title={g}>
            <table className="tbl">
              <thead><tr><th>Line</th><th className="right">IRMS</th><th style={{ width: 130 }}>Old system / POS</th><th className="right">Variance</th><th>Note</th></tr></thead>
              <tbody>{lines.map((l) => {
                const v = variance(l);
                return (
                  <tr key={l.key}>
                    <td>{l.label}</td><td className="num">{peso(l.system)}</td>
                    <td><input className="num" value={ext[l.key] ?? ''} onChange={(e) => setExt({ ...ext, [l.key]: e.target.value })} placeholder="-" /></td>
                    <td className="num" style={{ color: v ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{v == null ? '' : pesoSigned(v)}</td>
                    <td><input value={notes[l.key] || ''} onChange={(e) => setNotes({ ...notes, [l.key]: e.target.value })} placeholder={v ? 'Required' : ''} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </Panel>
        ))}
      </div>
      <div className="actionbar">
        <Field label="Overall notes"><input value={overall} onChange={(e) => setOverall(e.target.value)} style={{ width: 380 }} /></Field>
        <b>Total absolute variance: {peso(total)}</b>
        <span className="sp" />
        <button className="btn gold" disabled={a.busy} onClick={() => a.run(async () => {
          const external = {};
          for (const [k, v] of Object.entries(ext)) if (v !== '') external[k] = toCents(v);
          await api.post('/reports/reconciliation', { business_date: date, external, notes_by_line: notes, notes: overall });
          setSaved(true); await reload();
        })}>Save reconciliation</button>
      </div>
      {d?.saved?.length > 0 && (
        <Panel title="Saved reconciliations for this date">
          <table className="tbl"><thead><tr><th>Prepared</th><th>Lines compared</th><th className="right">Total variance</th><th>Notes</th></tr></thead>
            <tbody>{d.saved.map((r) => (
              <tr key={r.id}><td className="small">{r.prepared_by} {fmtDateTime(r.prepared_at)}</td>
                <td className="small">{r.lines.filter((l) => l.external != null).map((l) => `${l.group} ${l.label}: ${pesoSigned(l.variance)}${l.note ? ` (${l.note})` : ''}`).join('; ')}</td>
                <td className="num">{peso(r.total_variance)}</td><td className="small">{r.notes}</td></tr>
            ))}</tbody></table>
        </Panel>
      )}
    </div>
  );
}
