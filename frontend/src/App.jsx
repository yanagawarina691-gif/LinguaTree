import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import FeedPage from './pages/FeedPage.jsx'
import InternalizePage from './pages/InternalizePage.jsx'
import DeepenPage from './pages/DeepenPage.jsx'
import MigrationPage from './pages/MigrationPage.jsx'
import TreePage from './pages/TreePage.jsx'
import KnowledgeCardPage from './pages/KnowledgeCardPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import TabBar from './components/TabBar.jsx'

export default function App() {
  const { loading } = useAuth();
  const location = useLocation();
  const showTabBar = ['/', '/tree', '/me'].includes(location.pathname);

  if (loading) {
    return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>加载中...</div>;
  }

  return (
    <>
      <div id="phone">
        <div id="app">
          <Routes>
            <Route path="/" element={<FeedPage />} />
            <Route path="/deepen/:videoId" element={<DeepenPage />} />
            <Route path="/internalize/:videoId" element={<InternalizePage />} />
            <Route path="/migration/:videoId" element={<MigrationPage />} />
            <Route path="/tree" element={<TreePage />} />
            <Route path="/ore/:oreId" element={<KnowledgeCardPage />} />
            <Route path="/me" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {showTabBar && <TabBar />}
      </div>
      <div id="toast" className="toast"></div>
    </>
  );
}
