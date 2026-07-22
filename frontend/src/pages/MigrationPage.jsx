import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getMigration, evaluateMigration } from '../api/videos.js';

export default function MigrationPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [charCount, setCharCount] = useState(0);

  const loadScenario = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMigration(videoId);
      setScenario(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => { loadScenario(); }, [loadScenario]);

  const handleInput = (e) => {
    const val = e.target.value;
    setUserInput(val);
    setCharCount(val.length);
  };

  const handleSubmit = async () => {
    if (userInput.trim().length < 5) {
      setError('请至少写出5个字符的回答');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const data = await evaluateMigration(videoId, userInput);
      setResult(data);
    } catch (err) {
      setError('评估请求失败: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ===== 加载中 =====
  if (loading) return (
    <div className="page active migration-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="migration-loading">
        <div className="parse-spinner" style={{ margin: '0 auto 12px' }}></div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-lt)' }}>AI 正在生成迁移场景...</div>
      </div>
    </div>
  );

  // ===== 错误 =====
  if (error && !result) return (
    <div className="page active migration-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 20 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'center' }}>{error}</div>
      <button className="btn3d btn-primary" style={{ padding: '14px 32px', fontSize: 15 }} onClick={() => navigate('/')}>返回首页</button>
    </div>
  );

  // ===== 评估结果展示 =====
  if (result) {
    const { evaluation, xpGained, treeUpdate } = result;
    const score = evaluation.overall_score || 0;
    const scoreColor = score >= 80 ? 'var(--primary)' : score >= 60 ? 'var(--orange)' : 'var(--red)';

    return (
      <div className="page active migration-page">
        <div className="topbar">
          <div className="topbar-btn" onClick={() => navigate('/')} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>迁移结果</div>
          <div style={{ width: 40 }}></div>
        </div>

        <div className="migration-result-wrap">
          {/* 评分环 */}
          <div className="migration-score-ring">
            <div className="migration-score-num" style={{ color: scoreColor }}>{score}</div>
            <div className="migration-score-label">迁移评分</div>
          </div>

          {/* XP 获得 */}
          <div className="migration-xp-banner">
            <span style={{ fontSize: 20 }}>⚡</span>
            <span style={{ fontWeight: 800, color: 'var(--primary)' }}>+{xpGained} XP</span>
            <span style={{ fontSize: 13, color: 'var(--text-lt)' }}>已获得</span>
          </div>

          {/* 知识树升级提示 */}
          {treeUpdate?.leveledUp && (
            <div className="migration-levelup">
              🌳 知识节点「{treeUpdate.node_name}」升级了！
            </div>
          )}

          {/* 准确率 */}
          <div className="migration-eval-card">
            <div className="migration-eval-title">✅ 用法准确率</div>
            <div className="migration-eval-score" style={{ color: scoreColor }}>
              {evaluation.accuracy_score || 0}%
            </div>
          </div>

          {/* 维度评分 */}
          {evaluation.criteria_scores?.length > 0 && (
            <div className="migration-eval-card">
              <div className="migration-eval-title">📊 维度评分</div>
              {evaluation.criteria_scores.map((cs, i) => (
                <div key={i} className="migration-criteria-row">
                  <div className="migration-criteria-name">{cs.criterion}</div>
                  <div className="migration-criteria-bar-wrap">
                    <div className="migration-criteria-bar" style={{
                      width: `${cs.score}%`,
                      background: cs.score >= 80 ? 'var(--primary)' : cs.score >= 60 ? 'var(--orange)' : 'var(--red)'
                    }}></div>
                  </div>
                  <div className="migration-criteria-score">{cs.score}</div>
                </div>
              ))}
            </div>
          )}

          {/* 亮点 */}
          {evaluation.strengths?.length > 0 && (
            <div className="migration-eval-card">
              <div className="migration-eval-title">🌟 亮点</div>
              {evaluation.strengths.map((s, i) => (
                <div key={i} className="migration-bullet" style={{ color: 'var(--primary)' }}>• {s}</div>
              ))}
            </div>
          )}

          {/* 改进建议 */}
          {evaluation.improvement_suggestion && (
            <div className="migration-eval-card">
              <div className="migration-eval-title">💡 改进建议</div>
              <div className="migration-suggestion-text">{evaluation.improvement_suggestion}</div>
            </div>
          )}

          {/* 更地道表达 */}
          {evaluation.better_expression && (
            <div className="migration-eval-card migration-better-card">
              <div className="migration-eval-title">📖 更地道的表达</div>
              <div className="migration-better-text">{evaluation.better_expression}</div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="migration-btn-row">
            <button className="btn3d btn-primary migration-btn" onClick={() => navigate('/tree')}>🌳 查看知识树</button>
            <button className="btn3d btn-gray migration-btn" onClick={() => navigate('/')}>继续学习</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== 场景迁移页面 =====
  if (!scenario) return null;

  return (
    <div className="page active migration-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate('/')} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>场景迁移</div>
        <div onClick={() => navigate('/')} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      <div className="migration-content">
        {/* XP 提示 */}
        <div className="migration-xp-hint">
          ✨ 完成迁移可获得额外 50+ XP
        </div>

        {/* 场景标题 */}
        <div className="migration-scenario-card">
          <div className="migration-scenario-tag">
            🎯 {scenario.node_name} · {scenario.difficulty}
          </div>
          <div className="migration-scenario-title">{scenario.scenario_title}</div>
          <div className="migration-scenario-desc">{scenario.scenario_description}</div>
        </div>

        {/* 用户任务 */}
        <div className="migration-task-card">
          <div className="migration-task-label">✏️ 你的任务</div>
          <div className="migration-task-text">{scenario.user_task}</div>
        </div>

        {/* 回答输入区 */}
        <div className="migration-input-section">
          <div className="migration-input-label">你的回答</div>
          <textarea
            className="migration-textarea"
            placeholder="在这里用英文写出你的回答..."
            value={userInput}
            onChange={handleInput}
            rows={6}
            maxLength={500}
          />
          <div className="migration-char-count">{charCount}/500</div>
        </div>

        {error && <div className="migration-error">{error}</div>}

        {/* 操作按钮 */}
        <div className="migration-submit-row">
          <button
            className="btn3d btn-primary migration-submit-btn"
            onClick={handleSubmit}
            disabled={submitting || userInput.trim().length < 5}
          >
            {submitting ? (
              <>
                <div className="parse-spinner" style={{ width: 16, height: 16 }}></div>
                AI 评估中...
              </>
            ) : (
              <>提交评估 →</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
