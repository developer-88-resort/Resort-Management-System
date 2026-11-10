import { useEffect, useState } from 'react';
import { api } from './api.js';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { ErrorBox, Field } from './components/ui.jsx';
import SignInLayout from './components/SignInLayout.jsx';
import { ConfirmHost, NotificationBell, Toaster } from './components/notify.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Reservations from './pages/Reservations.jsx';
import FollowUp from './pages/FollowUp.jsx';
import ReservationForm from './pages/ReservationForm.jsx';
import ReservationView from './pages/ReservationView.jsx';
import CheckIn from './pages/CheckIn.jsx';
import RoomTransfer from './pages/RoomTransfer.jsx';
import CheckOut from './pages/CheckOut.jsx';
import RegistrationForm from './pages/RegistrationForm.jsx';
import Availability from './pages/Availability.jsx';
import RoomBoard from './pages/RoomBoard.jsx';
import DayTourList from './pages/DayTourList.jsx';
import GroupCheckIn from './pages/GroupCheckIn.jsx';
import LockerAssignment from './pages/LockerAssignment.jsx';
import GroupSettlement from './pages/GroupSettlement.jsx';
import LockerBoard from './pages/LockerBoard.jsx';
import DepartmentPOS from './pages/DepartmentPOS.jsx';
import ChargeSlip from './pages/ChargeSlip.jsx';
import Payments from './pages/Payments.jsx';
import Receipt from './pages/Receipt.jsx';
import Reports from './pages/Reports.jsx';
import { AdminUsers, AdminRooms, AdminRates, AdminSettings, AdminAudit } from './pages/Admin.jsx';
import OpeningRecords from './pages/OpeningRecords.jsx';
import Approvals from './pages/Approvals.jsx';
import Reconciliation from './pages/Reconciliation.jsx';

const NAV = [
  { sec: 'Overview' },
  { to: '/', label: 'Dashboard', end: true },
  { sec: 'Front Office', perm: ['reservation.view', 'frontdesk'] },
  { to: '/reservations', label: 'Reservations', perm: ['reservation.view'] },
  { to: '/reservations/new', label: 'New Reservation', perm: ['reservation.edit'] },
  { to: '/availability', label: 'Availability Calendar', perm: ['reservation.view'] },
  { to: '/inhouse', label: 'In-house Guests', perm: ['frontdesk'] },
  { to: '/followup', label: 'Down Payment Follow-up', perm: ['reservation.edit'] },
  { to: '/pending', label: 'Waiting for Room', perm: ['frontdesk'] },
  { to: '/payments', label: 'Cashier & Receipts', perm: ['frontdesk', 'reports'] },
  { to: '/approvals', label: 'Approvals', perm: ['frontdesk', 'approve'], badge: true },
  { sec: 'Day Tour', perm: ['daytour.view'] },
  { to: '/daytour', label: 'Day Tour Groups', perm: ['daytour.view'] },
  { to: '/daytour/new', label: 'New Group Check-in', perm: ['daytour'] },
  { to: '/lockers', label: 'Locker Board', perm: ['daytour.view'] },
  { sec: 'Housekeeping', perm: ['rooms.view'] },
  { to: '/rooms', label: 'Room Board', perm: ['rooms.view'] },
  { sec: 'Departments', perm: ['department'] },
  { to: '/department', label: 'Sales & Charges', perm: ['department'] },
  { sec: 'Management', perm: ['reports', 'admin'] },
  { to: '/reports', label: 'Reports', perm: ['reports'] },
  { to: '/reconciliation', label: 'Daily Reconciliation', perm: ['reports', 'frontdesk'] },
  { to: '/admin/audit', label: 'Audit Trail', perm: ['reports'] },
  { sec: 'Administration', perm: ['admin', 'approve'] },
  { to: '/admin/opening', label: 'Cutover Opening Records', perm: ['approve'] },
  { to: '/admin/users', label: 'Users & Roles', perm: ['admin'] },
  { to: '/admin/rooms', label: 'Rooms & Categories', perm: ['admin'] },
  { to: '/admin/rates', label: 'Day Tour Rates', perm: ['admin'] },
  { to: '/admin/settings', label: 'Settings', perm: ['admin'] },
];

function Login() {
  const { login } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await login(u, p); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <SignInLayout>
      <form className="card" onSubmit={submit}>
        <div className="signin-form-heading"><span className="signin-form-icon" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg></span><h1>Sign in</h1></div>
        <div className="stack" style={{ padding: 24 }}>
          <Field label="Username"><input placeholder="Enter your username" value={u} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="username" /></Field>
          <div className="field signin-password-field">
            <label htmlFor="signin-password">Password</label>
            <div className="signin-password-control">
              <input id="signin-password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
              <button type="button" className="signin-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-controls="signin-password" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <ErrorBox error={err} />
          <button className="btn gold" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}<span aria-hidden="true">&rarr;</span></button>
        </div>
      </form>
    </SignInLayout>
  );
}

function Shell({ children }) {
  const { user, logout, can, today } = useAuth();
  const loc = useLocation();
  const visible = NAV.filter((n) => !n.perm || n.perm.some(can));
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!can('approve')) return undefined;
    const load = () => api.get('/approvals?status=Pending').then((d) => setPending(d.pending)).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [loc.pathname]); // eslint-disable-line
  const items = visible.filter((n, i) => !n.sec || (visible[i + 1] && !visible[i + 1].sec));
  const current = [...NAV].filter((n) => n.to && (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0];
  return (
    <div className="app">
      <aside className="sidebar noprint">
        <div className="brand"><div className="k">88 HOTSPRING RESORT</div><div className="t">IRMS</div></div>
        <nav className="nav">
          {items.map((n, i) => n.sec
            ? <div key={i} className="sec">{n.sec}</div>
            : <NavLink key={n.to} to={n.to} end={n.end || n.to === '/reservations' || n.to === '/daytour'}>{n.label}{n.badge && pending > 0 && <span className="badge amber" style={{ marginLeft: 8, padding: '0 7px' }}>{pending}</span>}</NavLink>)}
        </nav>
        <div className="userbox">
          <b>{user.full_name}</b>{user.role_label}
          <div style={{ marginTop: 8 }}><button className="btn sm outline" onClick={logout}>Sign out</button></div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar noprint">
          <span className="crumb">IRMS &nbsp;|&nbsp; {current?.label || 'Front Office'}</span>
          <span className="sp" />
          <NotificationBell />
          <span className="who">{user.role_label}: {user.username} &nbsp; {today}</span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, user } = useAuth();
  if (loading) return <><Toaster placement="center" /><ConfirmHost /><div style={{ padding: 40 }}>Loading…</div></>;
  // Toaster and ConfirmHost stay mounted across sign-in and sign-out so those messages are seen.
  if (!user) return <><Toaster placement="center" /><ConfirmHost /><Login /></>;
  return (
    <><Toaster /><ConfirmHost /><Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/reservations" element={<Reservations key="all" />} />
        <Route path="/inhouse" element={<Reservations key="inhouse" view="inhouse" />} />
        <Route path="/followup" element={<FollowUp />} />
        <Route path="/pending" element={<Reservations key="pending" view="pending" />} />
        <Route path="/reservations/new" element={<ReservationForm />} />
        <Route path="/reservations/:id" element={<ReservationView />} />
        <Route path="/reservations/:id/edit" element={<ReservationForm />} />
        <Route path="/reservations/:id/checkin" element={<CheckIn />} />
        <Route path="/reservations/:id/checkout" element={<CheckOut />} />
        <Route path="/reservations/:id/lines/:lineId/transfer" element={<RoomTransfer />} />
        <Route path="/reservations/:id/registration" element={<RegistrationForm />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/rooms" element={<RoomBoard />} />
        <Route path="/daytour" element={<DayTourList />} />
        <Route path="/daytour/new" element={<GroupCheckIn />} />
        <Route path="/daytour/:id" element={<GroupCheckIn />} />
        <Route path="/daytour/:id/lockers" element={<LockerAssignment />} />
        <Route path="/daytour/:id/settlement" element={<GroupSettlement />} />
        <Route path="/lockers" element={<LockerBoard />} />
        <Route path="/department" element={<DepartmentPOS />} />
        <Route path="/department/slip/:id" element={<ChargeSlip />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/receipt/:id" element={<Receipt />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/rooms" element={<AdminRooms />} />
        <Route path="/admin/rates" element={<AdminRates />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/audit" element={<AdminAudit />} />
        <Route path="/admin/opening" element={<OpeningRecords />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell></>
  );
}
