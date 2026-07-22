import { useNavigate, useLocation } from 'react-router-dom';

export default function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const routes = [
    { path: '/', icon: '📺', label: 'Feed' },
    { path: '/tree', icon: '🌳', label: '知识树' },
    { path: '/archive', icon: '📇', label: '归档' },
    { path: '/me', icon: '👤', label: '我的' },
  ];

  return (
    <div id="tabbar">
      {routes.map(r => (
        <div
          key={r.path}
          className={`tab-item ${location.pathname === r.path ? 'active' : ''}`}
          onClick={() => !r.disabled && navigate(r.path)}
        >
          <div className="tab-icon">{r.icon}</div>
          <div className="tab-label">{r.label}</div>
          {r.badge && <div className="tab-badge">{r.badge}</div>}
        </div>
      ))}
    </div>
  );
}
