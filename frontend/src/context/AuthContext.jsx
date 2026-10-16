import { createContext, useContext, useEffect, useState } from 'react';
import { api, configureApiAccess, resetApiAccess } from '../api/client.js';

const AuthContext = createContext(null);
const DEFAULT_USER = { userId: 'default', nickname: 'Learner' };
const DEMO_USER = { userId: 'fictional-demo', nickname: '示例学习者（虚构）' };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, readOnly: true, mode: null, modeError: '' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    resetApiAccess();
    setState({ loading: true, readOnly: true, mode: null, modeError: '' });
    api('/api/info', { signal: controller.signal, cache: 'no-store' })
      .then(info => {
        if (!active) return;
        configureApiAccess(info);
        setState({ loading: false, readOnly: info.readOnly, mode: info.mode, modeError: '' });
      })
      .catch(error => {
        if (!active) return;
        resetApiAccess();
        setState({ loading: false, readOnly: true, mode: null,
          modeError: error.name === 'AbortError' ? '连接超时，请检查服务后重试。' : error.message });
      })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); resetApiAccess(); };
  }, [reload]);

  return (
    <AuthContext.Provider value={{ ...state,
      user: state.readOnly ? DEMO_USER : DEFAULT_USER,
      retryMode: () => setReload(value => value + 1),
      login: () => {}, register: () => {}, logout: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
