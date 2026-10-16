import { useState, useEffect, useCallback } from 'react';
import TopBar from '../components/TopBar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getUserStats } from '../api/user.js';

export default function ProfilePage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const { user, readOnly } = useAuth();

  const loadStats = useCallback(async () => {
    try {
      setError('');
      const data = await getUserStats();
      setStats(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <div className="page active me-page">
      <TopBar title={readOnly ? "示例学习档案" : "个人中心"} />
      <div className="me-header">
        <div className="me-avatar">
          <img src="/assets/crystal-mascot.png" width="48" height="48" style={{ objectFit: 'contain' }} alt="mascot" />
        </div>
        <div className="me-name">{user?.nickname || '未登录'}</div>
      </div>
      {readOnly && <p className="demo-profile-note">等级、XP 和徽章均为虚构示例，不代表你的学习记录。</p>}
      {error && <div className="demo-empty" role="alert">
        <p>{error}</p><button className="btn3d btn-gray" onClick={loadStats}>重新加载</button>
      </div>}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">💎</div>
          <div className="stat-num"><span className="count-up">{stats?.activatedOres ?? '—'}</span></div>
          <div className="stat-label">点亮矿石</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔥</div>
          <div className="stat-num"><span className="count-up">{stats?.streakDays ?? '—'}</span></div>
          <div className="stat-label">{readOnly ? '示例连续天数' : '连续天数'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-num"><span className="count-up">{stats?.totalXp ?? '—'}</span></div>
          <div className="stat-label">{readOnly ? '示例总 XP' : '总 XP'}</div>
        </div>
      </div>
      <div className="achievements">
        <div className="me-section-title">{readOnly ? '示例成就徽章' : '成就徽章'}</div>
        <div className="ach-grid">
          {[
            { name: '语感捕手',   img: '/assets/badges/badge-yugan.png',   unlocked: (stats?.totalMigrationCorrect || 0) >= 20 },
            { name: '词海摆渡人', img: '/assets/badges/badge-cihai.png',   unlocked: (stats?.totalFlashcardWords  || 0) >= 100 },
            { name: '环球探险家', img: '/assets/badges/badge-huanqiu.png', unlocked: (stats?.totalChoiceCorrect   || 0) >= 50 },
            { name: '地道演说家', img: '/assets/badges/badge-didao.png',   unlocked: (stats?.totalMigrations      || 0) >= 20 },
            { name: '跨境通才',   img: '/assets/badges/badge-kuaJing.png', unlocked: (stats?.totalFillCorrect     || 0) >= 30 },
          ].map((a, i) => (
            <div key={i} className={`ach-item ${a.unlocked ? '' : 'locked'}`}>
              <div className="ach-icon">
                <img src={a.img} width="48" height="48" style={{ objectFit: 'contain' }} alt={a.name} />
              </div>
              <div className="ach-name">{a.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="me-footer" style={{ padding: '20px 0', textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: '#9CA3AF' }}>LinguaTree v1.0</span>
      </div>
    </div>
  );
}
