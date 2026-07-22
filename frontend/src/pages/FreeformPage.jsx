import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getFreeformQuestion, evaluateFreeform } from '../api/videos.js';

export default function FreeformPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [charCount, setCharCount] = useState(0);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFreeformQuestion(videoId);
      setQuestion(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => { load(); }, [load]);

  const handleInput = (e) => {
    const val = e.target.value;
    setUserInput(val);
    setCharCount(val.length);
  };

  const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (toast) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500); }
  };

  const handleSubmit = async () => {
    if (userInput.trim().length < 3) {
      setError('请至少写出3个字符的回答');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const data = await evaluateFreeform(videoId, userInput);
      setResult(data);
      if (data.xpGained > 0) {
        showToast(`⚡ +${data.xpGained} XP`);
        if (data.treeUpdate?.leveledUp) {
          setTimeout(() => showToast(`🎉 ${data.treeUpdate.node_name} 升级！`), 1200);
        }
      }
    } catch (err) {
      setError('评估失败: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="parse-spinner"></div>
    </div>
  );

  if (error && !result && !question) return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
      <div style={{ color: 'var(--text-lt)', marginBottom: 16 }}>{error}</div>
      <button className="btn3d btn-primary" onClick={() => navigate(`/training/${videoId}`)}>返回训练</button>
    </div>
  );

  // 评估结果页
  if (result) {
    const { evaluation, xpGained, treeUpdate } = result;
    const score = evaluation.overall_score || 0;
    const scoreColor = score >= 80 ? 'var(--primary)' : score >= 60 ? 'var(--orange)' : 'var(--red)';

    return (
      <div className="page active freeform-page">
        <div className="topbar">
          <div className="topbar-btn" onClick={() => navigate(`/training/${videoId}`)} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>问答题结果</div>
          <div style={{ width: 40 }}></div>
        </div>

        <div className="freeform-result-wrap">
          {/* 评分环 */}
          <div className="freeform-score-ring">
            <div className="freeform-score-num" style={{ color: scoreColor }}>{score}</div>
            <div className="freeform-score-label">总分</div>
          </div>

          {/* XP */}
          <div className="freeform-xp-banner">
            <span style={{ fontSize: 20 }}>⚡</span>
            <span style={{ fontWeight: 800, color: 'var(--primary)' }}>+{xpGained} XP</span>
            <span style={{ fontSize: 13, color: 'var(--text-lt)' }}>已获得</span>
          </div>

          {treeUpdate?.leveledUp && (
            <div className="freeform-levelup">🌳 知识节点「{treeUpdate.node_name}」升级了！</div>
          )}

          {/* 准确率 */}
          <div className="freeform-eval-card">
            <div className="freeform-eval-title">✅ 用法准确率</div>
            <div className="freeform-eval-score" style={{ color: scoreColor }}>{evaluation.accuracy || 0}%</div>
          </div>

          {/* 维度评分 */}
          {evaluation.criteria_scores?.length > 0 && (
            <div className="freeform-eval-card">
              <div className="freeform-eval-title">📊 维度评分</div>
              {evaluation.criteria_scores.map((cs, i) => (
                <div key={i} className="freeform-criteria-row">
                  <div className="freeform-criteria-name">{cs.criterion}</div>
                  <div className="freeform-criteria-bar-wrap">
                    <div className="freeform-criteria-bar" style={{
                      width: `${cs.score}%`,
                      background: cs.score >= 80 ? 'var(--primary)' : cs.score >= 60 ? 'var(--orange)' : 'var(--red)'
                    }}></div>
                  </div>
                  <div className="freeform-criteria-score">{cs.score}</div>
                </div>
              ))}
            </div>
          )}

          {/* 改进建议 */}
          {evaluation.improvement && (
            <div className="freeform-eval-card">
              <div className="freeform-eval-title">💡 改进建议</div>
              <div className="freeform-suggestion-text">{evaluation.improvement}</div>
            </div>
          )}

          {/* 更地道表达 */}
          {evaluation.better_expression && (
            <div className="freeform-eval-card freeform-better-card">
              <div className="freeform-eval-title">📖 更地道的表达</div>
              <div className="freeform-better-text">{evaluation.better_expression}</div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="freeform-btn-row">
            <button className="btn3d btn-primary freeform-btn" onClick={() => navigate(`/migration/${videoId}`)}>
              🎯 去场景迁移
            </button>
            <button className="btn3d btn-gray freeform-btn" onClick={() => navigate('/archive')}>
              📇 查看归档
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 问答题页面
  if (!question) return null;

  return (
    <div className="page active freeform-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate(`/training/${videoId}`)} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>问答题表达</div>
        <div onClick={() => navigate(`/migration/${videoId}`)} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      <div className="freeform-content">
        {/* XP 提示 */}
        <div className="freeform-xp-hint">
          ✨ 完成问答题可获得额外 20+ XP
        </div>

        {/* 题目卡片 */}
        <div className="freeform-question-card">
          <div className="freeform-question-tag">
            ✏️ {question.target_knowledge} · {question.difficulty}
          </div>
          <div className="freeform-question-text">{question.question}</div>
          {question.evaluation_criteria?.length > 0 && (
            <div className="freeform-criteria-hint">
              评估维度: {question.evaluation_criteria.join(' / ')}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="freeform-input-section">
          <div className="freeform-input-label">你的回答</div>
          <textarea
            className="freeform-textarea"
            placeholder="在这里用英文写出你的回答..."
            value={userInput}
            onChange={handleInput}
            rows={5}
            maxLength={200}
          />
          <div className="freeform-char-count">{charCount}/200</div>
        </div>

        {error && <div className="freeform-error">{error}</div>}

        {/* 提交按钮 */}
        <div className="freeform-submit-row">
          <button
            className="btn3d btn-primary freeform-submit-btn"
            onClick={handleSubmit}
            disabled={submitting || userInput.trim().length < 3}
          >
            {submitting ? (
              <><div className="parse-spinner" style={{ width: 16, height: 16 }}></div>AI 评估中...</>
            ) : (
              <>提交评估 →</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
