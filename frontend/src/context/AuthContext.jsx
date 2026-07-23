import { createContext, useContext } from 'react';

const AuthContext = createContext(null);

const DEFAULT_USER = { userId: 'default', nickname: 'Learner' };

export function AuthProvider({ children }) {
  return (
    <AuthContext.Provider value={{ user: DEFAULT_USER, loading: false, login: () => {}, register: () => {}, logout: () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
