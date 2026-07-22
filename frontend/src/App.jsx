import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import LoginPage from './pages/LoginPage.jsx'
import FeedPage from './pages/FeedPage.jsx'
import DeepenPage from './pages/DeepenPage.jsx'
import TrainingPage from './pages/TrainingPage.jsx'
import MigrationPage from './pages/MigrationPage.jsx'
import TreePage from './pages/TreePage.jsx'
import BranchDetailPage from './pages/BranchDetailPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import TabBar from './components/TabBar.jsx'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>加载中...</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  const location = useLocation();
  const showTabBar = ['/', '/tree', '/me'].includes(location.pathname);
  const isLoginPage = location.pathname === '/login';

  return (
    <>
      <div id="phone">
        <div id="app">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedRoute><FeedPage /></ProtectedRoute>} />
            <Route path="/deepen/:videoId" element={<ProtectedRoute><DeepenPage /></ProtectedRoute>} />
            <Route path="/training/:videoId" element={<ProtectedRoute><TrainingPage /></ProtectedRoute>} />
            <Route path="/migration/:videoId" element={<ProtectedRoute><MigrationPage /></ProtectedRoute>} />
            <Route path="/tree" element={<ProtectedRoute><TreePage /></ProtectedRoute>} />
            <Route path="/branch/:branchId" element={<ProtectedRoute><BranchDetailPage /></ProtectedRoute>} />
            <Route path="/me" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {showTabBar && <TabBar />}
      </div>
      {!isLoginPage && <div id="toast" className="toast"></div>}
    </>
  );
}
