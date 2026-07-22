import { useNavigate } from 'react-router-dom';
import CrystalGalaxy from '../components/galaxy/CrystalGalaxy.jsx';
import '../styles/crystal-galaxy.css';

export default function TreePage() {
  const navigate = useNavigate();

  return (
    <div className="page active tree-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate('/')} style={{ fontSize: '20px' }}>‹</div>
        <div className="topbar-logo" style={{ fontSize: '18px' }}>矿石星图</div>
        <div style={{ width: '40px' }} />
      </div>
      <CrystalGalaxy />
    </div>
  );
}
