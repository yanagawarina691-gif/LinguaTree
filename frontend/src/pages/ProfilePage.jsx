import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getUserStats } from '../api/user.js';

const ACHIEVEMENTS = [
  { name: '初次发芽', pos: '0 0', threshold: 1 },
  { name: '5日连击', pos: '50% 0', threshold: 5 },
  { name: '解析10条视频', pos: '100% 0', threshold: 10 },
  { name: '知识树初成', pos: '0 100%', threshold: 20 },
  { name: '学霸认证', pos: '50% 100%', threshold: 50 },
  { name: '50个知识点', pos: '100% 100%', threshold: 50 },
];

export default function ProfilePage() {
  const [stats, setStats] = useState(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
        <div className="me-avatar">🦊</div>
        <div className="me-name">{user?.nickname || '未登录'}</div>
        <div className="me-level">Lv.{Math.floor((stats?.totalXp || 0) / 100)} 知识播种者</div>
        <div className="me-xp-bar"><div className="me-xp-fill" style={{ width: `${Math.min(100, (stats?.totalXp || 0) % 100)}%` }}></div></div>
        <div className="me-xp-text">{stats?.totalXp || 0} XP</div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-icon">📹</div><div className="stat-num">{stats?.videosParsed || 0}</div><div className="stat-label">解析视频</div></div>
        <div className="stat-card"><div className="stat-icon">🌿</div><div className="stat-num">{stats?.nodesActivated || 0}</div><div className="stat-label">点亮节点</div></div>
        <div className="stat-card"><div className="stat-icon">🔥</div><div className="stat-num">5</div><div className="stat-label">连续天数</div></div>
        <div className="stat-card"><div className="stat-icon">⭐</div><div className="stat-num">{stats?.totalXp || 0}</div><div className="stat-label">总 XP</div></div>
      </div>
      <div className="weekly-chart">
        <div className="section-title">本周进度</div>
        <div className="chart-bars">
          {weekData.map((v, i) => (
            <div key={i} className="chart-bar-col">
              <div className={`chart-bar ${v === 0 ? 'rest' : ''}`} style={{ height: v === 0 ? 4 : (v / maxVal * 80) }}></div>
              <div className="chart-day">{days[i]}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="achievements">
        <div className="section-title">成就徽章</div>
        <div className="ach-grid">
          {ACHIEVEMENTS.map((a, i) => {
            const unlocked = (stats?.nodesActivated || 0) >= a.threshold;
            return (
              <div key={i} className={`ach-item ${unlocked ? '' : 'locked'}`}>
                <div className="badge-sprite" style={{ backgroundPosition: a.pos, backgroundImage: "url('/assets/achievement-badges.png')" }}></div>
                <div className="ach-name">{a.name}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding: '0 20px 100px' }}>
        <button className="btn3d btn-gray" style={{ width: '100%', padding: 14, fontSize: 15 }} onClick={() => { logout(); navigate('/login'); }}>退出登录</button>
      </div>
    </div>
  );
}
