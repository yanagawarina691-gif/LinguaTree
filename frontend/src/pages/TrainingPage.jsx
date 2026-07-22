import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getVideoDetail, completeExercises } from '../api/videos.js';

export default function TrainingPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [attempts, setAttempts] = useState([]);
  const [showResult, setShowResult] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [xpGained, setXpGained] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 游戏化状态
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [showStreak, setShowStreak] = useState(false);
  const [xpPopup, setXpPopup] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [wrongQueue, setWrongQueue] = useState([]); // 错题重生队列
  const [isReplayRound, setIsReplayRound] = useState(false); // 是否在重答错题
  const timerRef = useRef(null);
  const answeredRef = useRef(false);

  const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (toast) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500); }
  };

  const loadVideo = useCallback(async () => {
    try {
      const data = await getVideoDetail(videoId);
      if (data.status !== 'done') { setError('视频还在解析中...'); setLoading(false); return; }
      setVideo(data);
      const exList = [];
      if (data.exercises?.choice) exList.push({ ...data.exercises.choice, typeLabel: 'choice', typeName: '选择' });
      if (data.exercises?.fill) exList.push({ ...data.exercises.fill, typeLabel: 'fill', typeName: '填空' });
      if (data.exercises?.judge) exList.push({ ...data.exercises.judge, typeLabel: 'truefalse', typeName: '判断' });
      setExercises(exList);
      setLoading(false);
    } catch (err) { setError(err.message); setLoading(false); }
  }, [videoId]);

  useEffect(() => { loadVideo(); }, [loadVideo]);

  // 倒计时
  useEffect(() => {
    if (showResult || loading || exercises.length === 0) return;
    setTimeLeft(15);
    answeredRef.current = false;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (!answeredRef.current) handleTimeout();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [currentQ, showResult]);

  const handleTimeout = () => {
    answeredRef.current = true;
    setCombo(0);
    handleAnswer(false, false, '', true);
  };

  const triggerStreak = (newCombo) => {
    if (newCombo >= 3) {
      setShowStreak(true);
      setTimeout(() => setShowStreak(false), 1200);
    }
  };

  const showXpPopup = (xp) => {
    setXpPopup(xp);
    setTimeout(() => setXpPopup(null), 1500);
  };

  const handleAnswer = useCallback((isCorrect, isSkipped, userAnswer, isTimeout = false) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    clearInterval(timerRef.current);

    const q = exercises[currentQ];
    const newAttempt = { exerciseId: q.id, nodeId: q.node_id, isCorrect, isSkipped, userAnswer: String(userAnswer) };
    const newAttempts = [...attempts, newAttempt];
    setAttempts(newAttempts);

    if (isCorrect) {
      setCorrectCount(c => c + 1);
      const newCombo = combo + 1;
      setCombo(newCombo);
      setMaxCombo(m => Math.max(m, newCombo));
      triggerStreak(newCombo);
      const bonus = newCombo >= 3 ? 5 : 0;
      showXpPopup(5 + bonus);
    } else {
      setCombo(0);
      // 错题进入重生队列（非重答轮才入队，避免无限循环）
      if (!isReplayRound && !isSkipped) {
        setWrongQueue(q => [...q, exercises[currentQ]]);
      }
    }

    setTimeout(() => {
      if (currentQ < exercises.length - 1) {
        setCurrentQ(c => c + 1);
      } else if (wrongQueue.length > 0 && !isReplayRound) {
        // 进入错题重生轮
        setIsReplayRound(true);
        setExercises(wrongQueue);
        setWrongQueue([]);
        setCurrentQ(0);
        showToast(`🔄 ${wrongQueue.length} 道错题重生！`);
      } else {
        // 全部完成
        submitAll(newAttempts);
      }
    }, 2200);
  }, [currentQ, exercises, attempts, combo, wrongQueue, isReplayRound, isReplayRound, showToast]);

  const submitAll = async (allAttempts) => {
    try {
      const result = await completeExercises(videoId, allAttempts);
      setXpGained(result.treeUpdate?.totalXp || 0);
    } catch {
      setXpGained(40);
    }
    setShowResult(true);
  };

  if (loading) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>加载题目...</div>;
  if (error) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-lt)' }}>{error}</div>;
  if (!video || exercises.length === 0) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>暂无题目</div>;

  // 结果页
  if (showResult) {
    const allCorrect = correctCount >= exercises.length;
    return (
      <div className="page active training-page">
        {/* Streak Fire 残留特效 */}
        {showStreak && <div className="streak-fire-overlay"><span className="streak-text">STREAK! 🔥</span></div>}

        <div className="training-result">
          <div className="big-check">{allCorrect ? '🎉' : '✅'}</div>
          <div className="training-result-score">{correctCount}/{exercises.length}</div>
          <div className="training-result-label">获得 {xpGained} XP</div>

          {/* Combo 统计 */}
          <div className="training-combo-stats">
            <div className="combo-stat-item">
              <span className="combo-stat-icon">🔥</span>
              <span className="combo-stat-num">{maxCombo}</span>
              <span className="combo-stat-label">最高连击</span>
            </div>
          </div>

          {/* 问答题邀请 */}
          <div className="migration-invite-card">
            <div className="migration-invite-icon">✏️</div>
            <div className="migration-invite-title">用这个知识点表达一下吧？</div>
            <div className="migration-invite-desc">
              完成问答题表达可获得额外 <strong style={{ color: 'var(--primary)' }}>20+ XP</strong>
            </div>
            <div className="migration-invite-btns">
              <button className="btn3d btn-primary migration-invite-btn" style={{ padding: '14px 28px', fontSize: 15 }}
                onClick={() => navigate(`/freeform/${videoId}`)}>
                去表达 →
              </button>
              <button className="btn3d btn-gray migration-invite-btn" style={{ padding: '14px 28px', fontSize: 15 }}
                onClick={() => navigate(`/migration/${videoId}`)}>
                跳到迁移
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const q = exercises[currentQ];
  const timePct = (timeLeft / 15) * 100;
  const timeColor = timeLeft <= 3 ? 'var(--red)' : timeLeft <= 7 ? 'var(--orange)' : 'var(--primary)';

  return (
    <div className="page active training-page">
      {/* Streak Fire 特效 */}
      {showStreak && <div className="streak-fire-overlay"><span className="streak-text">STREAK! 🔥</span></div>}
      {/* XP 弹出 */}
      {xpPopup && <div className="xp-popup">+{xpPopup} XP</div>}

      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate(`/deepen/${videoId}`)} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>
          {isReplayRound ? '🔄 错题重生' : '巩固训练'}
        </div>
        <div onClick={() => handleAnswer(false, true, '')} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      {/* Combo + 倒计时 + 进度 */}
      <div className="training-header">
        <div className="training-progress">
          {exercises.map((_, i) => (
            <div key={i} className={`progress-dot ${i === currentQ ? 'active' : ''} ${i < currentQ ? 'done' : ''}`}></div>
          ))}
        </div>
        <div className="training-q-type">
          {q.typeName}题 · {currentQ + 1}/{exercises.length}
          {combo >= 2 && <span className="combo-badge" style={{ marginLeft: 8, color: 'var(--orange)' }}>🔥 x{combo}</span>}
        </div>
        {/* 倒计时条 */}
        <div className="timer-bar-wrap">
          <div className="timer-bar" style={{ width: `${timePct}%`, background: timeColor }}></div>
          <span className="timer-num" style={{ color: timeColor }}>{timeLeft}s</span>
        </div>
      </div>

      <div className="training-question">
        <div className="training-q-text">{q.question}</div>
        {q.typeLabel === 'choice' && (
          <div className="training-options">
            {q.options.map((opt, i) => (
              <div key={i} className="training-option" onClick={() => {
                document.querySelectorAll('.training-option').forEach(o => o.classList.add('disabled'));
                const correct = i === q.answer;
                const el = document.querySelectorAll('.training-option')[i];
                el.classList.add(correct ? 'correct' : 'wrong');
                if (!correct) document.querySelectorAll('.training-option')[q.answer].classList.add('correct');
                const exp = document.getElementById('exp');
                if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>${q.explanation || ''}`; exp.classList.add('show'); }
                handleAnswer(correct, false, opt);
              }}>
                <div className="opt-letter">{'ABCD'[i]}</div>
                <div>{opt}</div>
              </div>
            ))}
          </div>
        )}
        {q.typeLabel === 'fill' && (
          <>
            <input className="training-fill-input" placeholder="输入你的答案..." onKeyDown={e => {
              if (e.key === 'Enter') {
                const val = e.target.value;
                const correct = val.trim().toLowerCase() === q.answer.toLowerCase();
                e.target.style.borderColor = correct ? 'var(--primary)' : 'var(--red)';
                const exp = document.getElementById('exp');
                if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>正确答案：${q.answer}<br>${q.explanation || ''}`; exp.classList.add('show'); }
                handleAnswer(correct, false, val);
              }
            }} />
            <div className="training-explanation" id="exp"></div>
          </>
        )}
        {q.typeLabel === 'truefalse' && (
          <div className="training-options">
            <div className="training-option" onClick={() => {
              const opts = document.querySelectorAll('.training-option');
              opts.forEach(o => o.classList.add('disabled'));
              const correct = true === q.answer;
              opts[0].classList.add(correct ? 'correct' : 'wrong');
              if (!correct) opts[1].classList.add('correct');
              const exp = document.getElementById('exp');
              if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>${q.explanation || ''}`; exp.classList.add('show'); }
              handleAnswer(correct, false, true);
            }}><div className="opt-letter">✓</div><div>正确</div></div>
            <div className="training-option" onClick={() => {
              const opts = document.querySelectorAll('.training-option');
              opts.forEach(o => o.classList.add('disabled'));
              const correct = false === q.answer;
              opts[1].classList.add(correct ? 'correct' : 'wrong');
              if (!correct) opts[0].classList.add('correct');
              const exp = document.getElementById('exp');
              if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>${q.explanation || ''}`; exp.classList.add('show'); }
              handleAnswer(correct, false, false);
            }}><div className="opt-letter">✗</div><div>错误</div></div>
          </div>
        )}
        {q.typeLabel !== 'fill' && <div className="training-explanation" id="exp"></div>}
      </div>
    </div>
  );
}
