import { Icon } from '../components/Design.jsx';
// Printable guest registration form (signed at check-in). Layout PROPOSED; one per reservation or per room is RM-03.
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBox, useLoad } from '../components/ui.jsx';
import { fmtDate, guestsLabel, peso } from '../util.js';

export default function RegistrationForm() {
  const { id } = useParams();
  const { settings, user } = useAuth();
  const [d, , err] = useLoad(`/reservations/${id}`);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <p>Loading…</p>;
  const r = d.reservation;
  const lines = d.lines.filter((l) => l.line_status !== 'Cancelled');
  const cell = { border: '1px solid #000', padding: '6px 8px', verticalAlign: 'top' };
  return (
    <div>
      <div className="row noprint" style={{ marginBottom: 12 }}><button className="btn gold" onClick={() => window.print()}><Icon name="print" size={16} />Print</button><span className="muted small">A4. Guest signs; attach the signed copy at check-in.</span></div>
      <div className="printpage panel" style={{ maxWidth: '210mm', padding: '14mm', color: '#000', fontSize: 13 }}>
        <div style={{ textAlign: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{settings.business_name}</div>
          <div className="small">{settings.business_address}</div>
          <div style={{ fontWeight: 700, marginTop: 8, letterSpacing: '.1em' }}>GUEST REGISTRATION FORM</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={cell}>Reservation</td><td style={cell}><b>{r.reference}</b></td><td style={cell}>Source</td><td style={cell}>{r.source}</td></tr>
            <tr><td style={cell}>Primary guest</td><td style={cell} colSpan={3}><b>{d.guest.full_name}</b></td></tr>
            <tr><td style={cell}>Contact no.</td><td style={cell}>{d.guest.contact_no}</td><td style={cell}>Email</td><td style={cell}>{d.guest.email || ''}</td></tr>
            <tr><td style={cell}>Address</td><td style={cell} colSpan={3}>&nbsp;</td></tr>
            <tr><td style={cell}>Arrival</td><td style={cell}>{fmtDate(r.check_in)}</td><td style={cell}>Departure</td><td style={cell}>{fmtDate(r.check_out)} ({d.totals.nights} night/s)</td></tr>
            <tr><td style={cell}>ID presented</td><td style={cell}>{r.id_type || ''}</td><td style={cell}>Verified by</td><td style={cell}>{r.id_verified_by || ''}</td></tr>
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr>{['Room', 'Category', 'Rate / night', 'Guests'].map((h) => <th key={h} style={{ ...cell, background: '#eee' }}>{h}</th>)}</tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td style={cell}>{l.room_no}</td><td style={cell}>{l.category}</td><td style={{ ...cell, textAlign: 'right' }}>{peso(l.rate_per_night)}</td><td style={cell}>{guestsLabel(l)}</td></tr>)}</tbody>
        </table>
        <div style={{ marginTop: 10 }}>Total room charges: <b>{peso(d.totals.room)}</b> &nbsp; Paid: <b>{peso(d.totals.paid)}</b> &nbsp; Balance: <b>{peso(d.totals.outstanding)}</b></div>
        <p style={{ marginTop: 14, fontSize: 12 }}>
          I agree to the resort's house rules. I understand that charges from the Restaurant, Mini Bar, Massage and other outlets signed to my room are payable at check-out,
          and that lost or damaged property may be charged to my account. Personal data is collected only for registration and is handled according to the resort's privacy policy.
        </p>
        <div style={{ display: 'flex', gap: 40, marginTop: 40 }}>
          <div style={{ flex: 1, borderTop: '1px solid #000', textAlign: 'center', paddingTop: 4 }}>Guest signature over printed name</div>
          <div style={{ flex: 1, borderTop: '1px solid #000', textAlign: 'center', paddingTop: 4 }}>Front Office: {user.full_name}</div>
        </div>
      </div>
    </div>
  );
}
