import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getFlashcards, completeFlashcards } from '../api/videos.js';

export default function FlashcardPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownCount, setKnownCount] = useState(0);
  const [retryQueue, setRetryQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (toast) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500); }
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFlashcards(videoId);
      setCards(data.cards || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => { load(); }, [load]);

  const handleKnow = useCallback(async () => {
    setKnownCount(c => c + 1);
    nextCard();
  }, []);

  const handleRetry = useCallback(() => {
    // 当前卡片进入重试队列
    setRetryQueue(q => [...q, cards[currentIndex]]);
    nextCard();
  }, [cards, currentIndex]);

  const nextCard = useCallback(() => {
    setFlipped(false);
    setTimeout(() => {
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1);
      } else if (retryQueue.length > 0) {
        // 进入重试队列
        setCards(retryQueue);
        setRetryQueue([]);
        setCurrentIndex(0);
        showToast(`🔄 ${retryQueue.length} 张卡片需要再看看`);
      } else {
        // 全部完成
        setCompleted(true);
      }
    }, 300);
  }, [currentIndex, cards, retryQueue, showToast]);

  const finish = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await completeFlashcards(videoId);
      if (res.xpGained > 0) {
        showToast(`⚡ +${res.xpGained} XP`);
        if (res.treeUpdate?.leveledUp) {
          setTimeout(() => showToast(`🎉 ${res.treeUpdate.node_name} 升级！`), 1200);
        }
      }
      setTimeout(() => navigate(`/training/${videoId}`), 900);
    } catch {
      navigate(`/training/${videoId}`);
    } finally {
      setSubmitting(false);
    }
  }, [videoId, navigate, showToast]);

  if (loading) return (
    <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="parse-spinner"></div>
    </div>
  );

  if (error) return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
      <div style={{ color: 'var(--text-lt)', marginBottom: 16 }}>{error}</div>
      <button className="btn3d btn-primary" onClick={() => navigate(`/deepen/${videoId}`)}>返回加深理解</button>
    </div>
  );

  // 完成页
  if (completed) {
    const total = cards.length + knownCount;
    const accuracy = total > 0 ? Math.round((knownCount / total) * 100) : 100;
    return (
      <div className="page active flashcard-page">
        <div className="topbar">
          <div className="topbar-btn" onClick={() => navigate(`/deepen/${videoId}`)} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>闪卡回忆</div>
          <div style={{ width: 40 }}></div>
        </div>
        <div className="flashcard-complete">
          <div className="flashcard-complete-icon">✅</div>
          <div className="flashcard-complete-title">回忆完成！</div>
          <div className="flashcard-accuracy">
            <div className="flashcard-accuracy-num">{accuracy}%</div>
            <div className="flashcard-accuracy-label">回忆准确率</div>
          </div>
          <button className="btn3d btn-primary flashcard-next-btn" disabled={submitting}
            onClick={finish} style={{ padding: '14px 40px', fontSize: 16 }}>
            {submitting ? '记录中...' : '开始选择题检测 →'}
          </button>
        </div>
      </div>
    );
  }

  if (cards.length === 0) return (
    <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <button className="btn3d btn-primary" onClick={() => navigate(`/training/${videoId}`)}>跳过闪卡</button>
    </div>
  );

  const card = cards[currentIndex];
  const triggerIcon = { concept: '💡', structure: '🏗️', example: '📝' }[card.trigger_type] || '💡';

  return (
    <div className="page active flashcard-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate(`/deepen/${videoId}`)} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>闪卡回忆</div>
        <div onClick={() => navigate(`/training/${videoId}`)} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      {/* 进度 */}
      <div className="flashcard-progress">
        <div className="flashcard-dots">
          {Array.from({ length: cards.length }).map((_, i) => (
            <div key={i} className={`flashcard-dot ${i === currentIndex ? 'active' : ''} ${i < currentIndex ? 'done' : ''}`}></div>
          ))}
        </div>
        <div className="flashcard-counter">{currentIndex + 1} / {cards.length}</div>
      </div>

      {/* 闪卡 */}
      <div className="flashcard-area" onClick={() => setFlipped(!flipped)}>
        <div className={`flashcard ${flipped ? 'flipped' : ''}`}>
          <div className="flashcard-face flashcard-front">
            <div className="flashcard-trigger-icon">{triggerIcon}</div>
            <div className="flashcard-front-text">{card.front}</div>
            <div className="flashcard-hint">点击翻面</div>
          </div>
          <div className="flashcard-face flashcard-back">
            <div className="flashcard-back-text">{card.back}</div>
            <div className="flashcard-difficulty">{card.difficulty}</div>
          </div>
        </div>
      </div>

      {/* 自评按钮 */}
      {flipped && (
        <div className="flashcard-actions">
          <button className="btn3d btn-gray flashcard-action-btn" onClick={(e) => { e.stopPropagation(); handleRetry(); }}>
            🤔 再想想
          </button>
          <button className="btn3d btn-primary flashcard-action-btn" onClick={(e) => { e.stopPropagation(); handleKnow(); }}>
            😊 我知道
          </button>
        </div>
      )}
    </div>
  );
}
