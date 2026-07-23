import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { knowledgeCard, updateOreTags, reviewOre } from '../api/ores.js';
import CenterLoader from '../components/CenterLoader.jsx';
import '../styles/card-detail.css';

const STAGE_NAMES = ['种子', '苗芽', '晶簇', '盛晶'];

export default function KnowledgeCardPage() {
  const { oreId } = useParams();
  const navigate = useNavigate();

  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingTags, setEditingTags] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [reviewMsg, setReviewMsg] = useState('');

  const loadCard = useCallback(async () => {
    try {
      setLoading(true);
      const data = await knowledgeCard(oreId);
      setCard(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [oreId]);

  useEffect(() => { loadCard(); }, [loadCard]);

  const addTag = async () => {
    const tag = newTag.trim();
    if (!tag || !card) return;
    const tags = [...card.tags, tag];
    await updateOreTags(oreId, tags);
    setCard({ ...card, tags });
    setNewTag('');
  };

  const removeTag = async (tagToRemove) => {
    const tags = card.tags.filter(t => t !== tagToRemove);
    await updateOreTags(oreId, tags);
    setCard({ ...card, tags });
  };

  const handleCompleteReview = async () => {
    try {
      const data = await reviewOre(oreId);
      setReviewed(true);
      if (data.capped) {
        setReviewMsg('今日复习已达上限');
      } else if (data.leveledUp) {
        setReviewMsg(`🎉 升级！Lv.${data.level}  +${data.xpGain} XP`);
      } else {
        setReviewMsg(`复习完成 +${data.xpGain} XP`);
      }
      // 刷新度数
      const newCard = await knowledgeCard(oreId);
      setCard(newCard);
      setTimeout(() => setReviewMsg(''), 2500);
    } catch (e) {
      setReviewMsg('复习失败，请重试');
      setTimeout(() => setReviewMsg(''), 2500);
    }
  };

  if (loading) return (
    <div className="page active">
      <CenterLoader text="加载知识卡片..." spriteKey={0} />
    </div>
  );

  if (error) return (
    <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#EF4444' }}>{error}</div>
      <button className="btn3d btn-gray" onClick={() => navigate(-1)}>返回</button>
    </div>
  );

  const p = card.progress;
  const masteryPercent = Math.round((p.mastery || 0) * 100);

  return (
    <div className="page active card-detail-page" style={{ overflow: 'auto' }}>
      {/* 顶栏 */}
      <div className="topbar" style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div className="topbar-btn" onClick={() => navigate(-1)} style={{ fontSize: 20 }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>知识卡片</div>
        <div style={{ width: 40 }} />
      </div>

      <div className="card-body">
        {/* === 卡片头 === */}
        <div className="card-header-block">
          <div className="card-breadcrumb">
            {card.tags.slice(0, 3).map((t, i) => (
              <span key={i} className="card-breadcrumb-tag">{t}</span>
            ))}
          </div>
          <div className="card-title">{card.name}</div>
          <div className="card-meta-row">
            <span>📅 {p.last_review_at ? new Date(p.last_review_at).toLocaleDateString() : '未学习'}</span>
            <span>📊 阶段 {p.level}/{STAGE_NAMES.length} {STAGE_NAMES[p.level] || ''}</span>
          </div>
          <div className="card-mastery-bar-wrap">
            <div className="card-mastery-bar">
              <div className="card-mastery-fill" style={{ width: `${masteryPercent}%` }} />
            </div>
            <span className="card-mastery-num">{masteryPercent}%</span>
          </div>
        </div>

        {/* === 标签编辑 === */}
        <div className="card-block">
          <div className="card-block-title">🏷️ 标签</div>
          <div className="card-tags-row">
            {card.tags.map((t, i) => (
              <span key={i} className="card-tag" onClick={() => removeTag(t)} title="点击删除">#{t} ×</span>
            ))}
            {editingTags ? (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <input className="card-tag-input" value={newTag} onChange={e => setNewTag(e.target.value)}
                  placeholder="输入标签" onKeyDown={e => { if (e.key === 'Enter') addTag(); }} style={{ width: 80 }} />
                <button className="btn3d btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={addTag}>添加</button>
                <button className="btn3d btn-gray" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setEditingTags(false)}>取消</button>
              </span>
            ) : (
              <span className="card-tag card-tag-add" onClick={() => setEditingTags(true)}>+ 自定义标签</span>
            )}
          </div>
        </div>

        {/* === 核心概念 & 结构 (来自加深理解) === */}
        {card.deepen?.structured_content?.length > 0 && (
          <div className="card-block">
            {card.deepen.structured_content.map((sec, i) => (
              <div key={i} className={`card-sec ${sec.section === '定义' || sec.section === '核心概念' ? 'highlight' : ''}`}>
                <div className="card-sec-title">{['📝', '📖', '💡', '⚠️'][i] || '📝'} {sec.section}</div>
                <div className="card-sec-content">{sec.content}</div>
              </div>
            ))}
          </div>
        )}

        {/* === 来源视频 === */}
        {card.source_videos?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">📚 来源视频</div>
            {card.source_videos.map(v => (
              <div key={v.id} className="card-source-video" onClick={() => navigate(`/deepen/${v.id}`)}>
                <span>▶</span>
                <span>{v.title || v.summary?.slice(0, 20) || '未命名视频'}</span>
                <span className="card-sub-text">{new Date(v.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* === 关联卡片 Backlinks === */}
        {card.backlinks?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">🔗 关联卡片</div>
            <div className="card-backlinks-grid">
              {card.backlinks.map(bl => (
                <div key={bl.related_id} className="card-backlink-card" onClick={() => navigate(`/ore/${bl.related_id}`)}>
                  <div className="card-backlink-name">← {bl.related_name}</div>
                  <div className="card-backlink-meta">
                    <span className="card-backlink-type">{bl.link_type === 'migration_cover' ? '迁移场景' : '共现知识'}</span>
                    <span>{Math.round((bl.strength || 0) * 100)}% 关联</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === 易错点 & 补充 (来自加深理解) === */}
        {card.deepen && card.deepen.supplements?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">💡 补充知识</div>
            {card.deepen.supplements.map((s, i) => (
              <div key={i} className="card-supplement-item">
                <div className="card-supplement-title">{s.title}</div>
                <div className="card-supplement-content">{s.content}</div>
              </div>
            ))}
          </div>
        )}

        {/* === 易错点 === */}
        {card.deepen?.corrections?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">⚠️ 常见错误</div>
            {card.deepen.corrections.map((c, i) => (
              <div key={i} className="card-correction-item">
                <div className="card-correction-wrong">❌ {c.original}</div>
                <div className="card-correction-right">✅ {c.corrected}</div>
                <div className="card-correction-note">{c.explanation}</div>
              </div>
            ))}
          </div>
        )}

        {/* === 我的错题 === */}
        {card.wrong_answers?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">❌ 我的错题</div>
            {card.wrong_answers.map((wa, i) => (
              <div key={i} className="card-wrong-item">
                <div className="card-wrong-q">Q: {wa.question}</div>
                <div className="card-wrong-your">你的答案: <span className="text-red">{wa.user_answer}</span></div>
                <div className="card-wrong-correct">正确答案: <span className="text-green">{wa.correct_answer}</span></div>
                {wa.explanation && <div className="card-wrong-expl">{wa.explanation}</div>}
              </div>
            ))}
          </div>
        )}

        {/* === 迁移记录 === */}
        {card.migrations?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">🎯 迁移记录</div>
            {card.migrations.map((m, i) => (
              <div key={i} className="card-migration-item">
                <div className="card-migration-scenario">{m.scenario_title}</div>
                <div className="card-migration-meta">
                  <span className={`card-migration-score ${m.score >= 80 ? 'text-green' : m.score >= 60 ? 'text-orange' : 'text-red'}`}>
                    {m.score}/100
                  </span>
                  <span>+{m.xp_gained} XP</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === 闪卡 === */}
        {card.flashcards?.length > 0 && (
          <div className="card-block">
            <div className="card-block-title">🃏 闪卡速览</div>
            <div className="card-flashcards-grid">
              {card.flashcards.slice(0, 6).map((fc, i) => (
                <div key={i} className="card-flashcard-mini">
                  <div className="card-flashcard-mini-front">{fc.front}</div>
                  <div className="card-flashcard-mini-back">{fc.back}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 底部留白（tab bar 高度）*/}
        <div style={{ height: 72 }} />
      </div>

      {/* 复习按钮 */}
      <div className="card-review-bar">
        <button className="snake-card-btn snake-card-btn-primary" onClick={handleCompleteReview} disabled={reviewed}>
          {reviewed ? '✔ 已复习' : '📖 完成复习 +3 XP'}
        </button>
        {reviewMsg && <div className="card-review-msg">{reviewMsg}</div>}
      </div>
    </div>
  );
}
