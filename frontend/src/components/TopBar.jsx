import { useNavigate } from 'react-router-dom';

export default function TopBar({ title, showBack = true, rightSlot }) {
  const navigate = useNavigate();
  return (
    <div className="topbar">
      {showBack ? (
        <div className="topbar-btn" onClick={() => navigate(-1)} style={{ fontSize: '20px' }}>‹</div>
      ) : (
        <div style={{ width: '40px' }} />
      )}
      <div className="topbar-logo" style={{ fontSize: '18px' }}>{title}</div>
      {rightSlot || <div style={{ width: '40px' }} />}
    </div>
  );
}
