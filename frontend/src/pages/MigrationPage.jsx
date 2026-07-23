import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getMigration, evaluateMigration } from '../api/videos.js';
import CenterLoader from '../components/CenterLoader.jsx';

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
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

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
    <div className="page active migration-page">
      <CenterLoader text="AI 正在生成迁移场景..." spriteKey={2} />
    </div>
  );

  // ===== 错误 =====
  if (error && !result) return (
    <div className="page active migration-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 20 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'center' }}>{error}</div>
      <button className="btn3d btn-primary" style={{ padding: '14px 32px', fontSize: 15 }} onClick={() => navigate('/tree')}>查看矿石</button>
    </div>
  );

  // ===== 评估结果展示 =====
  if (result) {
    const { evaluation, xpGained, treeUpdate } = result;
    const score = evaluation.overall_score || 0;
    const scoreColor = score >= 80 ? 'var(--primary)' : score >= 60 ? 'var(--orange)' : 'var(--red)';

    return (
      <div className="page active migration-page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar" style={{ flexShrink: 0 }}>
          <div className="topbar-btn" onClick={() => navigate('/tree')} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>迁移结果</div>
          <div style={{ width: 40 }}></div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 100px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div className="migration-score-ring" style={{ width: 80, height: 80, flexShrink: 0 }}>
              <div className="migration-score-num" style={{ fontSize: 28, color: scoreColor }}>{score}</div>
              <div className="migration-score-label" style={{ fontSize: 10 }}>迁移评分</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="migration-xp-banner" style={{ padding: '8px 14px', marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>⚡</span>
                <span style={{ fontWeight: 800 }}>+{xpGained} XP</span>
              </div>
              {evaluation.accuracy_score !== undefined && (
                <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>用法准确率 {evaluation.accuracy_score}%</div>
              )}
            </div>
          </div>

          {treeUpdate?.leveledUp && (
            <div className="migration-levelup" style={{ padding: '8px 14px', fontSize: 13, marginBottom: 10 }}>
              🌳 知识节点「{treeUpdate.node_name}」升级了！
            </div>
          )}

          <div className="migration-eval-card" style={{ padding: '12px 14px', marginBottom: 8 }}>
            <div className="migration-eval-title" style={{ fontSize: 13, marginBottom: 8 }}>📊 评估详情</div>
            {evaluation.criteria_scores?.map((cs, i) => (
              <div key={i} className="migration-criteria-row" style={{ marginBottom: 6 }}>
                <div className="migration-criteria-name" style={{ fontSize: 11 }}>{cs.criterion}</div>
                <div className="migration-criteria-bar-wrap">
                  <div className="migration-criteria-bar" style={{ width: `${cs.score}%`, background: cs.score >= 80 ? 'var(--primary)' : cs.score >= 60 ? 'var(--orange)' : 'var(--red)' }}></div>
                </div>
                <div className="migration-criteria-score" style={{ fontSize: 12 }}>{cs.score}</div>
              </div>
            ))}
            {evaluation.improvement_suggestion && (
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, marginTop: 6, padding: '8px 10px', background: 'var(--bg-gray)', borderRadius: 8 }}>
                💡 {evaluation.improvement_suggestion}
              </div>
            )}
          </div>

          <div className="migration-btn-row" style={{ gap: 10 }}>
            <button className="btn3d btn-primary migration-btn" style={{ padding: 14, fontSize: 14 }} onClick={() => navigate('/tree')}>查看矿石星图</button>
            <button className="btn3d btn-gray migration-btn" style={{ padding: 14, fontSize: 14 }} onClick={() => navigate('/tree')}>回到矿石</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== 场景迁移页面 =====
  if (!scenario) return null;

  return (
    <div className="page active migration-page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="topbar" style={{ flexShrink: 0, paddingBottom: 4 }}>
        <div className="topbar-btn" onClick={() => navigate('/tree')} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>场景迁移</div>
        <div onClick={() => setShowSkipConfirm(true)} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      {showSkipConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 40 }}>
          <div style={{ background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 390, padding: '28px 24px 36px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>💎</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1A1A2E', marginBottom: 6 }}>确定跳过？</div>
            <div style={{ fontSize: 13, color: '#787E87', marginBottom: 20, lineHeight: 1.5 }}>
              如果跳过将无法获得水晶 XP 奖励哦<br />当前学习进度会被保留，随时可以回来继续
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn3d btn-primary" style={{ padding: 14, fontSize: 15, width: '100%' }}
                onClick={() => setShowSkipConfirm(false)}>
                💪 继续挑战
              </button>
              <button style={{ padding: 12, fontSize: 14, width: '100%', border: 'none', background: '#F3F4F6', borderRadius: 14, fontWeight: 700, color: '#9CA3AF', cursor: 'pointer' }}
                onClick={() => { setShowSkipConfirm(false); navigate('/tree'); }}>
                确认跳过 · 保存进度
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px' }}>
        <div className="migration-xp-hint" style={{ padding: '8px 14px', fontSize: 12, marginBottom: 10 }}>
          ✨ 完成迁移可获得额外 50+ XP
        </div>

        <div className="migration-scenario-card" style={{ padding: '14px 16px', marginBottom: 10 }}>
          <div className="migration-scenario-tag" style={{ fontSize: 11, marginBottom: 8 }}>
            🎯 {scenario.ore_name} · {scenario.difficulty}
          </div>
          <div className="migration-scenario-title" style={{ fontSize: 17, marginBottom: 6 }}>{scenario.scenario_title}</div>
          <div className="migration-scenario-desc" style={{ fontSize: 13 }}>{scenario.scenario_description}</div>
        </div>

        <div className="migration-task-card" style={{ padding: '12px 16px', marginBottom: 10 }}>
          <div className="migration-task-label" style={{ fontSize: 12, marginBottom: 4 }}>✏️ 你的任务</div>
          <div className="migration-task-text" style={{ fontSize: 13 }}>{scenario.user_task}</div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div className="migration-input-label" style={{ fontSize: 13, marginBottom: 6 }}>你的回答</div>
          <textarea className="migration-textarea" placeholder="在这里用英文写出你的回答..." value={userInput}
            onChange={handleInput} rows={4} maxLength={500} style={{ minHeight: 80 }} />
          <div className="migration-char-count">{charCount}/500</div>
        </div>

        {error && <div className="migration-error">{error}</div>}

        <button className="btn3d btn-primary migration-submit-btn" onClick={handleSubmit}
          disabled={submitting || userInput.trim().length < 5} style={{ width: '100%', padding: 14, fontSize: 15, marginBottom: 80 }}>
          {submitting ? <><div className="parse-spinner" style={{ width: 16, height: 16 }}></div> AI 评估中...</> : <>提交评估 →</>}
        </button>
      </div>
    </div>
  );
}
