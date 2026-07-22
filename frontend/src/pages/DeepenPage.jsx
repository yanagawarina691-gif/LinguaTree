import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { streamDeepen, postDeepenFeedback, completeDeepen, regenerateDeepen } from '../api/videos.js';

export default function DeepenPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();

  // 分段流式状态
  const [comment, setComment] = useState(null);          // {brief_comment, comment_type}
  const [corrections, setCorrections] = useState(null);   // null=未到, []=无纠错
  const [supplements, setSupplements] = useState(null);
  const [structured, setStructured] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [done, setDone] = useState(null);                 // done payload (含 videoId/title/topic)
  const [error, setError] = useState('');

  // 交互状态
  const [usefulActive, setUsefulActive] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [completed, setCompleted] = useState(false);

  // 打字机
  const [typedComment, setTypedComment] = useState('');
  const typingRef = useRef(null);

  const scrollRef = useRef(null);
  const completedRef = useRef(false);
  const abortRef = useRef(null);
  const startedRef = useRef(false);

  const showToast = useCallback((msg) => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
  }, []);

  // 打字机效果
  useEffect(() => {
    if (!comment?.brief_comment) return;
    const text = comment.brief_comment;
    let i = 0;
    if (typingRef.current) clearInterval(typingRef.current);
    typingRef.current = setInterval(() => {
      i++;
      setTypedComment(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(typingRef.current);
        typingRef.current = null;
      }
    }, 45);
    return () => { if (typingRef.current) clearInterval(typingRef.current); };
  }, [comment]);

  // 启动流式
  const startStream = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setComment(null);
    setCorrections(null);
    setSupplements(null);
    setStructured(null);
    setKeywords([]);
    setDone(null);
    setError('');
    setTypedComment('');

    streamDeepen(videoId, {
      onComment: (c) => setComment(c),
      onCorrections: (items) => setCorrections(items),
      onSupplements: (items) => setSupplements(items),
      onStructured: (sections, kws) => {
        setStructured(sections);
        setKeywords(kws);
      },
      onDone: (payload) => {
        setDone(payload);
        setCompleted(!!payload.deepenCompleted);
      },
      onError: (msg) => setError(msg),
    }, ctrl.signal);
  }, [videoId]);

  useEffect(() => {
    startStream();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [startStream]);

  // 滚动到底部 → 完成加深理解（+10 XP，幂等）
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || completedRef.current) return;
    // 全部内容到达后才触发
    if (!done) return;
    const threshold = 60;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      completedRef.current = true;
      (async () => {
        try {
          const res = await completeDeepen(videoId);
          if (res.xpGained > 0) {
            showToast(`⚡ +${res.xpGained} XP`);
            if (res.treeUpdate?.leveledUp) {
              setTimeout(() => showToast(`🎉 ${res.treeUpdate.node_name} 升级！`), 1200);
            }
            setCompleted(true);
          }
        } catch (e) { /* 幂等失败忽略 */ }
      })();
    }
  }, [done, videoId, showToast]);

  // 手动点击「开始练习」→ 完成后进入闪卡回忆（M5 三模态入口）
  const goPractice = useCallback(async () => {
    if (!completedRef.current) {
      completedRef.current = true;
      try {
        const res = await completeDeepen(videoId);
        if (res.xpGained > 0) {
          showToast(`⚡ +${res.xpGained} XP`);
          setTimeout(() => navigate(`/flashcards/${videoId}`), 900);
          return;
        }
      } catch {}
    }
    navigate(`/flashcards/${videoId}`);
  }, [videoId, navigate, showToast]);

  // 跳过（无 XP）→ 直接进入闪卡回忆
  const skipDeepen = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    navigate(`/flashcards/${videoId}`);
  }, [videoId, navigate]);

  // 标记有用
  const markUseful = useCallback(async () => {
    if (usefulActive) return;
    setUsefulActive(true);
    showToast('感谢反馈 👍');
    try { await postDeepenFeedback(videoId, { type: 'useful' }); } catch {}
  }, [usefulActive, videoId, showToast]);

  // 提交疑问
  const submitQuestion = useCallback(async () => {
    const msg = feedbackText.trim();
    if (!msg) { showToast('请先写下你的疑问'); return; }
    try {
      await postDeepenFeedback(videoId, { type: 'question', message: msg });
      setShowFeedback(false);
      setFeedbackText('');
      showToast('已收到你的疑问');
    } catch { showToast('提交失败，请稍后重试'); }
  }, [feedbackText, videoId, showToast]);

  // 重新生成
  const regenerate = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    completedRef.current = false;
    startedRef.current = false;
    showToast('正在重新生成...');
    try { await regenerateDeepen(videoId); } catch {}
    startStream();
  }, [videoId, startStream, showToast]);

  // 关键词高亮渲染
  const highlight = useCallback((text) => {
    if (!text || keywords.length === 0) return text;
    const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
    if (escaped.length === 0) return text;
    const re = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = String(text).split(re);
    return parts.map((p, i) =>
      escaped.some(e => new RegExp(`^${e}$`, 'i').test(p))
        ? <mark key={i} className="kw">{p}</mark>
        : p
    );
  }, [keywords]);

  const commentTypeIcon = { 点评: '💬', 提醒: '💡', 鼓励: '🌟' }[comment?.comment_type] || '💬';
  const loading = !done && !error;

  return (
    <div className="page active deepen-page" ref={scrollRef} onScroll={handleScroll}>
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate(-1)} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>加深理解</div>
        <div onClick={skipDeepen} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过 →</div>
      </div>

      {error && (
        <div className="deepen-error">
          <div className="deepen-error-icon">😕</div>
          <div className="deepen-error-text">{error}</div>
          <button className="btn3d btn-primary" style={{ marginTop: 16, padding: '12px 28px' }} onClick={regenerate}>重新生成</button>
        </div>
      )}

      {!error && (
        <>
          {/* 视频标题 + AI 回应 */}
          <div className="deepen-video-card">
            <div className="deepen-video-title">
              <span className="deepen-video-icon">📺</span>
              {done?.title || '解析完成'}
            </div>
            <div className="deepen-ai-comment">
              <span className="deepen-ai-avatar">AI</span>
              <span className="deepen-ai-text">
                {typedComment}
                {comment && typedComment.length < comment.brief_comment.length && <span className="cursor">|</span>}
              </span>
            </div>
          </div>

          <div className="deepen-divider"><span>AI 帮你梳理</span></div>

          {/* 纠错（仅在有纠错时出现） */}
          {corrections && corrections.length > 0 && (
            <div className="deepen-section">
              <div className="deepen-section-title deepen-correction-title">⚠️ 视频里有个小错误</div>
              {corrections.map((c, i) => (
                <div key={i} className="correction-card">
                  <div className="correction-row">
                    <span className="correction-label">原句</span>
                    <span className="correction-original">{c.original}</span>
                  </div>
                  <div className="correction-arrow">→</div>
                  <div className="correction-row">
                    <span className="correction-label correction-label-ok">正确</span>
                    <span className="correction-corrected">{c.corrected}</span>
                  </div>
                  <div className="correction-explanation">{highlight(c.explanation)}</div>
                </div>
              ))}
            </div>
          )}

          {/* 补充 */}
          {supplements && supplements.length > 0 && (
            <div className="deepen-section">
              <div className="deepen-section-title deepen-supplement-title">📌 还可以了解</div>
              {supplements.map((s, i) => (
                <div key={i} className="supplement-card">
                  <div className="supplement-title">{s.title}</div>
                  <div className="supplement-content">{highlight(s.content)}</div>
                  {s.relation && <div className="supplement-relation">↔ {s.relation}</div>}
                </div>
              ))}
            </div>
          )}

          {/* 知识点整理（可折叠） */}
          {structured && structured.length > 0 && (
            <div className="deepen-section">
              <div className="deepen-section-header" onClick={() => setCollapsed(c => !c)}>
                <span className="deepen-section-title deepen-structured-title">📋 知识点整理</span>
                <span className={`collapse-arrow ${collapsed ? '' : 'open'}`}>{collapsed ? '▸' : '▾'}</span>
              </div>
              {!collapsed && (
                <div className="structured-card">
                  {structured.map((sec, i) => (
                    <div key={i} className="structured-item">
                      <div className="structured-item-title">{sec.section}</div>
                      <div className="structured-item-content">{highlight(sec.content)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 流式中占位 */}
          {loading && (
            <div className="deepen-loading">
              <div className="deepen-spinner"></div>
              <span>AI 正在为你梳理...</span>
            </div>
          )}

          <div className="deepen-regen-row">
            <button className="deepen-regen-btn" onClick={regenerate}>🔄 重新生成</button>
          </div>
        </>
      )}

      {/* 底部固定操作栏 */}
      <div className="deepen-actionbar">
        <button className="deepen-action-btn" onClick={() => setShowFeedback(true)}>
          <span>💬</span><span>我有疑问</span>
        </button>
        <button className={`deepen-action-btn ${usefulActive ? 'active' : ''}`} onClick={markUseful} disabled={usefulActive}>
          <span>{usefulActive ? '👍' : '👍'}</span><span>{usefulActive ? '已标记' : '有用'}</span>
        </button>
        <button className="btn3d btn-primary deepen-practice-btn" onClick={goPractice}>
          开始练习 <span className="pulse-dot"></span>
        </button>
      </div>

      {/* 疑问反馈弹窗 */}
      {showFeedback && (
        <div className="deepen-modal-mask" onClick={() => setShowFeedback(false)}>
          <div className="deepen-modal" onClick={e => e.stopPropagation()}>
            <div className="deepen-modal-title">写下你的疑问</div>
            <textarea
              className="deepen-modal-input"
              placeholder="哪里不清楚？或者想了解什么？"
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="deepen-modal-actions">
              <button className="btn3d btn-gray" onClick={() => { setShowFeedback(false); setFeedbackText(''); }}>取消</button>
              <button className="btn3d btn-primary" onClick={submitQuestion}>提交</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
