import { useState, useEffect, useCallback } from 'react';
import TopBar from '../components/TopBar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getUserStats } from '../api/user.js';

export default function ProfilePage() {
  const [stats, setStats] = useState(null);
  const { user } = useAuth();

  const loadStats = useCallback(async () => {
    try {
      const data = await getUserStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const weekData = [40, 65, 30, 80, 50, 0, 55];
  const maxVal = Math.max(...weekData);
  const days = ['一','二','三','四','五','六','日'];

  return (
    <div className="page active me-page">
      <TopBar title="个人中心" />
      <div className="me-header">
        <div className="me-avatar">
          <img src="/assets/crystal-mascot.png" width="48" height="48" style={{ objectFit: 'contain' }} alt="mascot" />
        </div>
        <div className="me-name">{user?.nickname || '未登录'}</div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">💎</div>
          <div className="stat-num"><span className="count-up">{stats?.activatedOres || 0}</span></div>
          <div className="stat-label">点亮矿石</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔥</div>
          <div className="stat-num"><span className="count-up">5</span></div>
          <div className="stat-label">连续天数</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-num"><span className="count-up">{stats?.totalXp || 0}</span></div>
          <div className="stat-label">总 XP</div>
        </div>
      </div>
      <div className="achievements">
        <div className="me-section-title">成就徽章</div>
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
