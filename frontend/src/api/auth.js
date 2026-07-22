import { api, setToken, setUser, clearAuth, getToken, getUser } from './client.js';

export async function register(nickname) {
  const data = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
  setToken(data.token);
  setUser({ userId: data.userId, nickname: data.nickname });
  return data;
}

export async function login(nickname) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
  setToken(data.token);
  setUser({ userId: data.userId, nickname: data.nickname });
  return data;
}

export async function getMe() {
  return api('/api/auth/me');
}

export function isLoggedIn() {
  return !!getToken();
}

export function getCurrentUser() {
  return getUser();
}

export function logout() {
  clearAuth();
}
