import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCards } from '../api/cards.js';

export default function ArchivePage() {
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [reviewCards, setReviewCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all'); // all | review

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [allRes, reviewRes] = await Promise.all([
        getCards(false),
        getCards(true),
      ]);
      setCards(allRes.cards || []);
      setReviewCards(reviewRes.cards || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const levelName = { 0: '休眠', 1: '发芽', 2: '茂叶', 3: '开花' };
  const levelEmoji = { 0: '🌱', 1: '🌿', 2: '🍃', 3: '🌸' };
  const masteryColor = (c) => c === 'red' ? 'var(--red)' : c === 'orange' ? 'var(--orange)' : 'var(--primary)';

  const renderCard = (card) => (
    <div
      key={card.node_id}
      className={`archive-card ${card.due_today ? 'due' : ''}`}
      onClick={() => navigate(`/card/${card.node_id}`)}
    >
      {card.due_today && <div className="archive-due-badge">复习</div>}
      <div className="archive-card-header" style={{ borderLeftColor: card.color }}>
        <div className="archive-card-name">{levelEmoji[card.level || 0]} {card.name}</div>
        <div className="archive-card-branch">{card.top_branch_name}</div>
      </div>
      <div className="archive-card-def">{card.definition || '点击查看详情'}</div>
      <div className="archive-card-mastery">
        <div className="archive-mastery-label">掌握度</div>
        <div className="archive-mastery-bar-wrap">
          <div
            className="archive-mastery-bar"
            style={{ width: `${card.mastery}%`, background: masteryColor(card.mastery_color) }}
          ></div>
        </div>
        <div className="archive-mastery-pct" style={{ color: masteryColor(card.mastery_color) }}>{card.mastery}%</div>
      </div>
      {card.next_review_date && (
        <div className="archive-card-next">
          下次复习: {card.next_review_date.slice(0, 10)}
        </div>
      )}
    </div>
  );

  if (loading) return (
    <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="parse-spinner"></div>
    </div>
  );

  if (error) return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
      <div style={{ color: 'var(--text-lt)' }}>{error}</div>
    </div>
  );

  const showCards = tab === 'review' ? reviewCards : cards;

  return (
    <div className="page active archive-page">
      <div className="topbar">
        <div className="topbar-logo">📇 归档</div>
        <div className="topbar-actions">
          <div className="topbar-btn" onClick={() => navigate('/tree')}>🌳</div>
        </div>
      </div>

      {/* 今日推荐复习 */}
      {reviewCards.length > 0 && (
        <div className="archive-review-section">
          <div className="archive-section-title">
            🔔 今日推荐复习 <span className="count">{reviewCards.length}</span>
          </div>
          <div className="archive-review-list">
            {reviewCards.slice(0, 3).map(card => (
              <div
                key={card.node_id}
                className="archive-review-item"
                onClick={() => navigate(`/card/${card.node_id}`)}
              >
                <div className="archive-review-name">{card.name}</div>
                <div className="archive-review-meta">
                  <span style={{ color: masteryColor(card.mastery < 40 ? 'red' : card.mastery < 70 ? 'orange' : 'green') }}>
                    {card.mastery}%
                  </span>
                  {card.review_count > 0 && <span> · 已复习{card.review_count}次</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="archive-tabs">
        <div className={`archive-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          全部卡片 <span className="count">{cards.length}</span>
        </div>
        <div className={`archive-tab ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}>
          待复习 <span className="count">{reviewCards.length}</span>
        </div>
      </div>

      {/* 卡片网格 */}
      {showCards.length === 0 ? (
        <div className="archive-empty">
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {tab === 'review' ? '暂无待复习卡片' : '还没有学过的知识卡片'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-lt)' }}>
            {tab === 'review' ? '今日复习已完成！' : '解析视频后，学过的知识点会自动归档到这里'}
          </div>
          <button className="btn3d btn-primary" style={{ marginTop: 20, padding: '12px 28px' }}
            onClick={() => navigate('/')}>
            去解析视频
          </button>
        </div>
      ) : (
        <div className="archive-grid">
          {showCards.map(renderCard)}
        </div>
      )}
    </div>
  );
}
