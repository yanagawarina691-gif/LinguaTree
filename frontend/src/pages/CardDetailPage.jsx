import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCardDetail, reviewCard } from '../api/cards.js';

export default function CardDetailPage() {
  const { nodeId } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getCardDetail(nodeId);
      setCard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
  };

  // 自评复习：用户自评记忆程度 → quality 分值
  const handleSelfReview = async (quality) => {
    setReviewing(true);
    try {
      const res = await reviewCard(nodeId, quality);
      setReviewResult(res);
      showToast(`已记录复习！下次复习: ${res.nextReviewDate.slice(0, 10)}`);
      // 刷新卡片数据
      load();
    } catch (err) {
      showToast('记录失败: ' + err.message);
    } finally {
      setReviewing(false);
    }
  };

  if (loading) return (
    <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="parse-spinner"></div>
    </div>
  );

  if (error || !card) return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
      <div style={{ color: 'var(--text-lt)', marginBottom: 16 }}>{error || '卡片不存在'}</div>
      <button className="btn3d btn-primary" onClick={() => navigate('/archive')}>返回归档</button>
    </div>
  );

  const levelName = { 0: '休眠', 1: '发芽', 2: '茂叶', 3: '开花' };
  const masteryColor = (c) => c === 'red' ? 'var(--red)' : c === 'orange' ? 'var(--orange)' : 'var(--primary)';
  const linkTypeLabel = {
    co_occurrence: '同视频',
    ai_supplement: 'AI补充',
    migration_cover: '迁移关联',
    user_manual: '手动标记',
  };

  return (
    <div className="page active card-detail-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate('/archive')} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>知识卡片</div>
        <div style={{ width: 40 }}></div>
      </div>

      <div className="card-detail-content">
        {/* 卡片头部 */}
        <div className="card-detail-header" style={{ borderLeftColor: card.color }}>
          <div className="card-detail-name">{card.name}</div>
          <div className="card-detail-path">
            📍 {card.top_branch_name} › {card.sub_branch}
          </div>
          <div className="card-detail-meta">
            <span>Lv{card.level} {levelName[card.level]}</span>
            <span>·</span>
            <span>{card.xp} XP</span>
            {card.last_review_at && <><span>·</span><span>上次: {card.last_review_at.slice(0, 10)}</span></>}
          </div>
          <div className="card-detail-mastery">
            <div className="archive-mastery-label">掌握度</div>
            <div className="archive-mastery-bar-wrap">
              <div className="archive-mastery-bar"
                style={{ width: `${card.mastery}%`, background: masteryColor(card.mastery_color) }}></div>
            </div>
            <div className="archive-mastery-pct" style={{ color: masteryColor(card.mastery_color) }}>{card.mastery}%</div>
          </div>
          {card.next_review_date && (
            <div className="card-detail-next">📅 下次复习: {card.next_review_date.slice(0, 10)}</div>
          )}
        </div>

        {/* 核心概念 */}
        {card.core_concept && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">📝 核心概念</div>
            <div className="card-detail-section-body">{card.core_concept}</div>
          </div>
        )}

        {/* 结构 */}
        {card.structure && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">📖 结构</div>
            <div className="card-detail-section-body card-structured">{card.structure}</div>
          </div>
        )}

        {/* 例句 */}
        {card.examples.length > 0 && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">💡 例句</div>
            {card.examples.map((ex, i) => (
              <div key={i} className="card-detail-example">{ex}</div>
            ))}
          </div>
        )}

        {/* 易错点 */}
        {card.pitfalls.length > 0 && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">⚠️ 易错点</div>
            {card.pitfalls.map((p, i) => (
              <div key={i} className="card-detail-pitfall">{p}</div>
            ))}
          </div>
        )}

        {/* 关联卡片 backlinks */}
        {card.backlinks.length > 0 && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">🔗 关联卡片 ({card.backlinks.length})</div>
            {card.backlinks.map((bl, i) => (
              <div key={i} className="card-detail-backlink"
                onClick={() => navigate(`/card/${bl.node_id}`)}>
                <span className="bl-arrow">{bl.link_type === 'ai_supplement' ? '→' : '←'}</span>
                <span className="bl-name">{bl.node_name}</span>
                <span className="bl-type">{linkTypeLabel[bl.link_type] || bl.link_type}</span>
                <span className="bl-branch">{bl.branch}</span>
              </div>
            ))}
          </div>
        )}

        {/* 来源视频 */}
        {card.source_videos.length > 0 && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">📚 来源视频</div>
            {card.source_videos.map((v, i) => (
              <div key={i} className="card-detail-source"
                onClick={() => navigate(`/deepen/${v.id}`)}>
                📺 {v.title} <span className="source-date">{v.date?.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 我的错题 */}
        {card.wrong_exercises.length > 0 && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">❌ 我的错题 ({card.wrong_exercises.length})</div>
            {card.wrong_exercises.map((e, i) => (
              <div key={i} className="card-detail-wrong">
                <div className="wrong-question">{e.question}</div>
                <div className="wrong-answer">
                  你的答案: <span className="wrong">{e.user_answer || '(空)'}</span>
                </div>
                <div className="wrong-answer">
                  正确答案: <span className="correct">
                    {e.type === 'choice' && e.options ? e.options[e.correct_answer] : e.correct_answer}
                  </span>
                </div>
                {e.explanation && <div className="wrong-explanation">{e.explanation}</div>}
              </div>
            ))}
          </div>
        )}

        {/* 迁移记录 */}
        {card.migration_records.length > 0 && (
          <div className="card-detail-section">
            <div className="card-detail-section-title">🎯 迁移记录</div>
            {card.migration_records.map((m, i) => (
              <div key={i} className="card-detail-migration">
                <div className="migration-scenario">{m.scenario_title}</div>
                <div className="migration-score-row">
                  <span>评分: <strong style={{ color: m.overall_score >= 80 ? 'var(--primary)' : m.overall_score >= 60 ? 'var(--orange)' : 'var(--red)' }}>{m.overall_score}/100</strong></span>
                  <span>+{m.xp_gained} XP</span>
                  <span className="migration-date">{m.date?.slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 自评复习 */}
        <div className="card-detail-section card-review-section">
          <div className="card-detail-section-title">🔄 自评复习</div>
          <div className="card-review-hint">你还记得这个知识点吗？</div>
          <div className="card-review-btns">
            <button className="btn3d btn-gray card-review-btn" disabled={reviewing}
              onClick={() => handleSelfReview(20)}>😵 完全忘了</button>
            <button className="btn3d btn-gray card-review-btn" disabled={reviewing}
              onClick={() => handleSelfReview(50)}>🤔 模糊</button>
            <button className="btn3d btn-gray card-review-btn" disabled={reviewing}
              onClick={() => handleSelfReview(80)}>😊 记得</button>
            <button className="btn3d btn-primary card-review-btn" disabled={reviewing}
              onClick={() => handleSelfReview(100)}>🤩 很熟</button>
          </div>
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="card-detail-actionbar">
        <button className="deepen-action-btn" onClick={() => navigate(`/training/${card.source_videos[0]?.id || ''}`)}
          disabled={!card.source_videos[0]}>
          <span>✏️</span><span>再练一道</span>
        </button>
        <button className="deepen-action-btn" onClick={() => navigate(`/migration/${card.source_videos[0]?.id || ''}`)}
          disabled={!card.source_videos[0]}>
          <span>🎯</span><span>迁移练习</span>
        </button>
        <button className="btn3d btn-primary deepen-practice-btn" onClick={() => navigate('/archive')}>
          返回归档
        </button>
      </div>
    </div>
  );
}
