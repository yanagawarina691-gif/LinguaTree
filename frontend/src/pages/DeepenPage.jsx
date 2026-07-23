import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDeepen, completeDeepen, feedbackDeepen } from '../api/videos.js';
import CenterLoader from '../components/CenterLoader.jsx';

export default function DeepenPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [folded, setFolded] = useState(false);
  const [ thanked, setThanked ] = useState(false);
  const bottomRef = useRef(null);

  const loadDeepen = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getDeepen(videoId);
      setContent(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => { loadDeepen(); }, [loadDeepen]);

  const handleStartPractice = async () => {
    try {
      await completeDeepen(videoId, false);
      navigate(`/internalize/${videoId}`);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleSkip = async () => {
    try {
      await completeDeepen(videoId, true);
      navigate(`/internalize/${videoId}`);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleFeedback = async (type, index = -1) => {
    try {
      await feedbackDeepen(videoId, type, index);
      showToast(type === 'useful' ? '感谢反馈，我们会继续优化 ✨' : '已记录，AI 会据此改进');
      if (type === 'useful' && index === -1) setThanked(true);
    } catch (err) {
      showToast(err.message);
    }
  };

  const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
  };

  if (loading) {
    return (
      <div className="page active deepen-page">
        <CenterLoader text="AI 正在整理加深理解内容..." spriteKey={1} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page active deepen-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 20 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'center' }}>{error}</div>
        <button className="btn3d btn-primary" style={{ padding: '14px 32px', fontSize: 15 }} onClick={() => navigate('/')}>返回首页</button>
      </div>
    );
  }

  if (!content) return null;

  return (
    <div className="page active deepen-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate('/')} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>加深理解</div>
        <div onClick={handleSkip} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      <div className="deepen-content">
        {/* 视频标题与 AI 简短回应 */}
        <div className="deepen-hero">
          <div className="deepen-video-title">{content.video_title || '未命名视频'}</div>
          {content.brief_comment && (
            <div className="deepen-comment">
              <span className="deepen-comment-icon">💬</span>
              {content.brief_comment}
            </div>
          )}
        </div>

        {/* 纠错（仅在有时展示） */}
        {content.corrections && content.corrections.length > 0 && (
          <div className="deepen-section deepen-corrections">
            <div className="deepen-section-title">⚠️ 视频里有个小错误</div>
            {content.corrections.map((c, idx) => (
              <div key={idx} className="deepen-correction-card">
                <div className="deepen-correction-row">
                  <span className="deepen-label">原句</span>
                  <span className="deepen-wrong">{c.original}</span>
                </div>
                <div className="deepen-correction-row">
                  <span className="deepen-label">→ 正确</span>
                  <span className="deepen-right">{c.corrected}</span>
                </div>
                <div className="deepen-correction-explain">{c.explanation}</div>
                <div className="deepen-correction-actions">
                  <button className="deepen-feedback-btn" onClick={() => handleFeedback('useful', idx)}>👍 有用</button>
                  <button className="deepen-feedback-btn" onClick={() => handleFeedback('confused', idx)}>💬 有疑问</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 补充 */}
        {content.supplements && content.supplements.length > 0 && (
          <div className="deepen-section">
            <div className="deepen-section-title">📌 还可以了解</div>
            {content.supplements.map((s, idx) => (
              <div key={idx} className="deepen-supplement-card" onClick={() => s.related_ore_id && navigate('/tree')}>
                <div className="deepen-supplement-title">{s.title}</div>
                <div className="deepen-supplement-content">{s.content}</div>
                {s.relation && <div className="deepen-supplement-relation">↳ {s.relation}</div>}
              </div>
            ))}
          </div>
        )}

        {/* 结构化整理（可折叠） */}
        {content.structured_content && content.structured_content.length > 0 && (
          <div className="deepen-section">
            <div className="deepen-section-title deepen-fold" onClick={() => setFolded(f => !f)}>
              📋 知识点整理
              <span style={{ fontSize: 12, color: 'var(--text-lt)' }}>{folded ? '展开 ▼' : '折叠 ▲'}</span>
            </div>
            {!folded && (
              <div className="deepen-structured">
                {content.structured_content.map((section, idx) => (
                  <div key={idx} className="deepen-structured-item">
                    <div className="deepen-structured-title">{section.section}</div>
                    <div className="deepen-structured-body">{section.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* 底部固定操作栏 */}
      <div className="deepen-footer">
        <button className="deepen-footer-btn deepen-btn-confused" onClick={() => handleFeedback('confused')}>
          💬 我有疑问
        </button>
        <button className="deepen-footer-btn deepen-btn-useful" onClick={() => handleFeedback('useful')} disabled={thanked}>
          {thanked ? '👍 已标记有用' : '👍 有用'}
        </button>
        <button className="btn3d btn-primary deepen-start-btn" onClick={handleStartPractice}>
          开始练习 →
        </button>
      </div>
    </div>
  );
}
