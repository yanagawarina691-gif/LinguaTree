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
  const { loading, readOnly, modeError, retryMode } = useAuth();
  const location = useLocation();
  const showTabBar = ['/', '/tree', '/me'].includes(location.pathname);

  if (loading) {
    return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>加载中...</div>;
  }

  if (modeError) {
    return (
      <div id="phone">
        <div className="mode-error" role="alert">
          <h1>暂时无法打开演示</h1>
          <p>{modeError}</p>
          <p>尚未确认服务模式，提交功能已停用。</p>
          <button className="btn3d btn-primary" onClick={retryMode}>重试连接</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div id="phone" className={readOnly ? 'read-only-demo' : ''}>
        {readOnly && (
          <div className="demo-notice" role="note">
            <strong>只读演示 · 虚构示例</strong>
            <span>预生成内容与示例进度，仅供浏览，不保存作答</span>
          </div>
        )}
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
