import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const notify = (message, type = 'success') => window.dispatchEvent(new CustomEvent('irms:toast', { detail: { message, type } }));
/** Messages for the sign-in page are shown inside the sign-in card, not as a floating toast. */
export const NOTICE = 'irms.notice';
const signInNotice = (message, type) => {
  try { sessionStorage.setItem(NOTICE, JSON.stringify({ message, type })); } catch { /* ignore */ }
  window.dispatchEvent(new Event('irms:notice'));
};
const firstName = (u) => u.full_name.split(' ')[0];
// sessionStorage survives a page refresh but is cleared when the tab or browser is closed,
// so "Welcome back" shows once per opening of the system, not on every refresh.
const GREETED = 'irms.greeted';
const greeted = () => { try { return sessionStorage.getItem(GREETED) === '1'; } catch { return false; } };
const markGreeted = (on) => { try { on ? sessionStorage.setItem(GREETED, '1') : sessionStorage.removeItem(GREETED); } catch { /* ignore */ } };

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, perms: [], settings: {} });
  const refresh = useCallback(async () => {
    if (!getToken()) return setState({ loading: false, user: null, perms: [], settings: {} });
    try {
      const me = await api.get('/auth/me');
      setState({ loading: false, ...me });
      return me;
    } catch {
      setState({ loading: false, user: null, perms: [], settings: {} });
    }
  }, []);
  useEffect(() => {
    // Opening the system with a saved session: say who is signed in, so a shared PC is not used under someone else's name.
    refresh().then((me) => { if (!me?.user || greeted()) return; markGreeted(true); notify(`Welcome back, ${firstName(me.user)}. You are still signed in as ${me.user.role_label} (${me.user.username}). Sign out if this is not you.`, 'info'); });
    const out = () => {
      setState({ loading: false, user: null, perms: [], settings: {} });
      markGreeted(false);
      signInNotice('Your session has ended. Please sign in again.', 'error');
    };
    window.addEventListener('irms:logout', out);
    return () => window.removeEventListener('irms:logout', out);
  }, [refresh]);

  const login = async (username, password) => {
    const { token } = await api.post('/auth/login', { username, password });
    setToken(token);
    const me = await refresh();
    markGreeted(true);
    if (me?.user) notify(`Signed in. Welcome, ${firstName(me.user)} (${me.user.role_label}).`);
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setState({ loading: false, user: null, perms: [], settings: {} });
    markGreeted(false);
    signInNotice('You have signed out.', 'info');
  };
  const can = (p) => state.perms.includes(p);
  return <Ctx.Provider value={{ ...state, login, logout, can, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
