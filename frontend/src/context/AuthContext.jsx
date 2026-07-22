import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authApi from '../api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(authApi.getCurrentUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authApi.isLoggedIn()) {
      authApi.getMe()
        .then(u => setUserState(u))
        .catch(() => authApi.logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (nickname) => {
    const data = await authApi.login(nickname);
    setUserState({ userId: data.userId, nickname: data.nickname });
    return data;
  }, []);

  const register = useCallback(async (nickname) => {
    const data = await authApi.register(nickname);
    setUserState({ userId: data.userId, nickname: data.nickname });
    return data;
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUserState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
