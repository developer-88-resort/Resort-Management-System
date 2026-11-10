import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, perms: [], settings: {} });
  const refresh = useCallback(async () => {
    if (!getToken()) return setState({ loading: false, user: null, perms: [], settings: {} });
    try {
      const me = await api.get('/auth/me');
      setState({ loading: false, ...me });
    } catch {
      setState({ loading: false, user: null, perms: [], settings: {} });
    }
  }, []);
  useEffect(() => {
    refresh();
    const out = () => setState({ loading: false, user: null, perms: [], settings: {} });
    window.addEventListener('irms:logout', out);
    return () => window.removeEventListener('irms:logout', out);
  }, [refresh]);

  const login = async (username, password) => {
    const { token } = await api.post('/auth/login', { username, password });
    setToken(token);
    await refresh();
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setState({ loading: false, user: null, perms: [], settings: {} });
  };
  const can = (p) => state.perms.includes(p);
  return <Ctx.Provider value={{ ...state, login, logout, can, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
