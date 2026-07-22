import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nickname.trim()) { setError('请输入昵称'); return; }
    setLoading(true);
    setError('');
    try {
      await login(nickname.trim());
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <img src="/assets/mascot-tree.png" width="120" height="120" style={{ objectFit: 'contain', marginBottom: 16 }} alt="mascot" />
      <h1 style={{ fontFamily: 'Fredoka, ZCOOL KuaiLe, sans-serif', fontSize: 28, color: 'var(--primary)', marginBottom: 8 }}>LinguaTree</h1>
      <p style={{ fontSize: 14, color: 'var(--text-lt)', fontWeight: 600, marginBottom: 32 }}>刷视频，种知识树</p>
      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <div className="link-input-card">
          <input
            type="text"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="输入你的昵称"
            style={{ fontSize: 16, fontWeight: 600 }}
          />
          <button type="submit" className="btn3d btn-primary" style={{ width: '100%', marginTop: 12, padding: '14px', fontSize: 16 }} disabled={loading}>
            {loading ? '登录中...' : '🚀 开始学习'}
          </button>
          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</p>}
        </div>
      </form>
      <p style={{ fontSize: 12, color: 'var(--text-lt)', marginTop: 16 }}>首次输入昵称将自动注册</p>
    </div>
  );
}
