import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getVideoDetail,
  getFlashcards,
  completeFlashcards,
  getFreeformQuestion,
  evaluateFreeform,
  completeExercises,
} from '../api/videos.js';
import CenterLoader from '../components/CenterLoader.jsx';

const PHASE = {
  LOADING: 'loading',
  FLASHCARD: 'flashcard',
  CHOICE: 'choice',
  FREEFORM: 'freeform',
  RESULT: 'result',
};

export default function InternalizePage() {
  const { videoId } = useParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState(PHASE.LOADING);
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');

  // Flashcard state
  const [flashcards, setFlashcards] = useState([]);
  const [fcIndex, setFcIndex] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcKnown, setFcKnown] = useState(0);
  const [fcAgain, setFcAgain] = useState([]);

  // Choice state
  const [exercises, setExercises] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [attempts, setAttempts] = useState([]);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [streakFire, setStreakFire] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15);
  const [wrongQueue, setWrongQueue] = useState([]);
  const [choiceStats, setChoiceStats] = useState({ correct: 0, total: 0 });
  const [showingResult, setShowingResult] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [selectedCorrect, setSelectedCorrect] = useState(null);

  // Freeform state
  const [freeform, setFreeform] = useState(null);
  const [ffInput, setFfInput] = useState('');
  const [ffEvaluating, setFfEvaluating] = useState(false);
  const [ffResult, setFfResult] = useState(null);

  // Final state
  const [totalXp, setTotalXp] = useState(0);
  const [finalStats, setFinalStats] = useState(null);

  const timerRef = useRef(null);
  const attemptsRef = useRef([]);
  const wrongQueueRef = useRef([]);

  // Keep refs in sync with state
  useEffect(() => { attemptsRef.current = attempts; }, [attempts]);
  useEffect(() => { wrongQueueRef.current = wrongQueue; }, [wrongQueue]);

  // ========== Load video + flashcards ==========
  const loadData = useCallback(async () => {
    try {
      setPhase(PHASE.LOADING);
      const [videoData, fcData] = await Promise.all([
        getVideoDetail(videoId),
        getFlashcards(videoId),
      ]);

      if (videoData.status !== 'done') {
        setError('视频还在解析中...');
        setPhase(PHASE.LOADING);
        return;
      }

      setVideo(videoData);
      setFlashcards(fcData.flashcards || []);

      // Build choice exercise list from existing data
      const exList = [];
      if (videoData.exercises?.choice) exList.push({ ...videoData.exercises.choice, typeLabel: 'choice', typeName: '选择' });
      if (videoData.exercises?.fill) exList.push({ ...videoData.exercises.fill, typeLabel: 'fill', typeName: '填空' });
      if (videoData.exercises?.judge) exList.push({ ...videoData.exercises.judge, typeLabel: 'truefalse', typeName: '判断' });
      setExercises(exList);

      setPhase(PHASE.FLASHCARD);
    } catch (err) {
      setError(err.message);
      setPhase(PHASE.LOADING);
    }
  }, [videoId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ========== Flashcard logic ==========
  const handleFlip = () => setFcFlipped(true);

  const handleFlashcardKnow = async () => {
    const newKnown = fcKnown + 1;
    setFcKnown(newKnown);
    await advanceFlashcard(newKnown);
  };

  const handleFlashcardAgain = () => {
    setFcAgain(q => [...q, flashcards[fcIndex]]);
    advanceFlashcard(fcKnown);
  };

  const advanceFlashcard = async (knownCount) => {
    if (fcIndex < flashcards.length - 1) {
      setFcFlipped(false);
      setTimeout(() => setFcIndex(i => i + 1), 200);
      return;
    }

    // Flashcards done
    try {
      await completeFlashcards(videoId, knownCount);
    } catch (e) {
      // Non-blocking
    }
    setPhase(PHASE.CHOICE);
  };

  // ========== Choice exercise logic ==========
  const loadFreeform = useCallback(async (accuracy = null) => {
    const ffData = await getFreeformQuestion(videoId, accuracy);
    setFreeform(ffData);
    return ffData;
  }, [videoId]);

  useEffect(() => {
    if (phase !== PHASE.CHOICE || showingResult) return;
    if (exercises.length === 0) {
      loadFreeform(0)
        .then(() => setPhase(PHASE.FREEFORM))
        .catch(e => setError('加载问答题失败: ' + e.message));
      return;
    }

    setTimeLeft(15);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          handleTimeout();
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [phase, currentQ, showingResult, exercises.length, loadFreeform]);

  const handleTimeout = () => {
    if (showingResult) return;
    const q = getCurrentQuestion();
    if (!q) return;
    setSelectedOption('timeout');
    setSelectedCorrect(false);
    recordAnswer(false, true, '');
  };

  const getCurrentQuestion = () => {
    if (currentQ < exercises.length) return exercises[currentQ];
    if (wrongQueue.length > 0) return wrongQueue[0];
    return null;
  };

  const recordAnswer = (isCorrect, isSkipped, userAnswer) => {
    if (showingResult) return;
    setShowingResult(true);
    clearInterval(timerRef.current);

    const q = getCurrentQuestion();
    if (!q) return;

    const newAttempt = {
      exerciseId: q.id,
      oreId: q.ore_id,
      isCorrect,
      isSkipped,
      userAnswer: String(userAnswer),
    };

    const newAttempts = [...attemptsRef.current, newAttempt];
    attemptsRef.current = newAttempts;
    setAttempts(newAttempts);

    setChoiceStats(s => ({
      correct: s.correct + (isCorrect ? 1 : 0),
      total: s.total + 1,
    }));

    if (isCorrect && !isSkipped) {
      const newCombo = combo + 1;
      setCombo(newCombo);
      setMaxCombo(m => Math.max(m, newCombo));
      if (newCombo >= 3) {
        setStreakFire(true);
        setTimeout(() => setStreakFire(false), 1200);
      }
    } else {
      setCombo(0);
      if (!isSkipped && q) {
        const newWrongQueue = [...wrongQueueRef.current, q];
        wrongQueueRef.current = newWrongQueue;
        setWrongQueue(newWrongQueue);
      }
    }

    setTimeout(() => {
      setShowingResult(false);

      const isWrongQueue = currentQ >= exercises.length;
      if (isWrongQueue) {
        const newWrongQueue = wrongQueueRef.current.slice(1);
        wrongQueueRef.current = newWrongQueue;
        setWrongQueue(newWrongQueue);
        if (newWrongQueue.length === 0) {
          finishChoice(newAttempts);
        }
      } else if (currentQ < exercises.length - 1) {
        setCurrentQ(i => i + 1);
      } else {
        // Primary exercises done, check wrong queue
        if (wrongQueueRef.current.length > 0) {
          setCurrentQ(exercises.length);
        } else {
          finishChoice(newAttempts);
        }
      }
    }, isCorrect ? 1400 : 2200);
  };

  const finishChoice = async (finalAttempts) => {
    try {
      await completeExercises(videoId, finalAttempts);
    } catch (e) {
      // Non-blocking
    }

    const accuracy = finalAttempts.length > 0
      ? Math.round((finalAttempts.filter(a => a.isCorrect).length / finalAttempts.length) * 100)
      : 0;

    try {
      await loadFreeform(accuracy);
      setPhase(PHASE.FREEFORM);
    } catch (e) {
      setError('加载问答题失败: ' + e.message);
    }
  };

  const handleChoiceAnswer = (isCorrect, optionKey, userAnswer) => {
    setSelectedOption(optionKey);
    setSelectedCorrect(isCorrect);
    recordAnswer(isCorrect, false, userAnswer);
  };

  // Reset selection when moving to next question
  useEffect(() => {
    setSelectedOption(null);
    setSelectedCorrect(null);
  }, [currentQ]);

  const handleSkipChoice = () => {
    recordAnswer(false, true, '');
  };

  // ========== Freeform logic ==========
  const handleFreeformSubmit = async () => {
    if (!ffInput.trim() || ffEvaluating) return;
    setFfEvaluating(true);
    try {
      const result = await evaluateFreeform(videoId, ffInput);
      setFfResult(result);
      setTotalXp(prev => prev + (result.xpGained || 0));
      setFinalStats({
        flashcardsKnown: fcKnown,
        choiceCorrect: choiceStats.correct,
        choiceTotal: choiceStats.total,
        freeformScore: result.evaluation?.overall_score || 0,
        totalXp: result.treeUpdate?.totalXp || 0,
      });
      setPhase(PHASE.RESULT);
    } catch (err) {
      setError('评估失败: ' + err.message);
    } finally {
      setFfEvaluating(false);
    }
  };

  const handleSkipFreeform = () => {
    setFinalStats({
      flashcardsKnown: fcKnown,
      choiceCorrect: choiceStats.correct,
      choiceTotal: choiceStats.total,
      freeformScore: 0,
      totalXp: 0,
    });
    setPhase(PHASE.RESULT);
  };

  // ========== Render helpers ==========
  if (error) {
    return (
      <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-lt)', padding: 40, textAlign: 'center' }}>
        {error}
      </div>
    );
  }

  if (phase === PHASE.LOADING) {
    return (
      <div className="page active">
        <CenterLoader text="准备内化训练..." spriteKey={1} />
      </div>
    );
  }

  // ---------- Flashcard phase ----------
  if (phase === PHASE.FLASHCARD) {
    const card = flashcards[fcIndex];
    if (!card) return null;

    return (
      <div className="page active internalize-page">
        <div className="topbar">
          <div className="topbar-btn" onClick={() => navigate(-1)} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>闪卡回忆</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)' }}>{fcIndex + 1}/{flashcards.length}</div>
        </div>

        <div className="flashcard-progress">
          {flashcards.map((_, i) => (
            <div key={i} className={`flashcard-dot ${i === fcIndex ? 'active' : ''} ${i < fcIndex ? 'done' : ''}`} />
          ))}
        </div>

        <div className="flashcard-wrap">
          <div
            className={`flashcard-card ${fcFlipped ? 'flipped' : ''}`}
            onClick={handleFlip}
          >
            <div className="flashcard-face flashcard-front">
              <div className="flashcard-type">{card.trigger_type === 'word' ? '单词' : card.trigger_type === 'phrase' ? '短语' : card.trigger_type === 'collocation' ? '搭配' : '单词'}</div>
              <div className="flashcard-front-text">{card.front}</div>
              <div className="flashcard-hint">点击翻面</div>
            </div>
            <div className="flashcard-face flashcard-back">
              <div className="flashcard-back-text">{card.back}</div>
            </div>
          </div>
        </div>

        <div className="flashcard-actions">
          <button className="btn3d btn-gray flashcard-btn" onClick={handleFlashcardAgain}>🤔 再想想</button>
          <button className="btn3d btn-primary flashcard-btn" onClick={handleFlashcardKnow}>✅ 我知道</button>
        </div>
      </div>
    );
  }

  // ---------- Choice phase ----------
  if (phase === PHASE.CHOICE) {
    const q = getCurrentQuestion();
    if (!q) return null;

    return (
      <div className="page active internalize-page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {streakFire && <div className="streak-fire">🔥 STREAK! 🔥</div>}

        <div className="topbar" style={{ flexShrink: 0, paddingBottom: 4 }}>
          <div className="topbar-btn" onClick={() => navigate(-1)} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>巩固检测</div>
          <div onClick={handleSkipChoice} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
        </div>

        <div style={{ textAlign: 'center', padding: '4px 20px', flexShrink: 0 }}>
          <div className="game-stats" style={{ justifyContent: 'center', gap: 20, marginBottom: 4 }}>
            <div className="game-stat combo-stat">
              <span className="game-stat-num">{combo}</span>
              <span className="game-stat-label">连击</span>
            </div>
            <div className="game-timer">
              <svg viewBox="0 0 36 36" className="timer-ring">
                <path className="timer-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path className="timer-fg" strokeDasharray={`${(timeLeft / 15) * 100}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <span className="timer-num">{timeLeft}</span>
            </div>
            <div className="game-stat">
              <span className="game-stat-num">{choiceStats.correct}/{choiceStats.total}</span>
              <span className="game-stat-label">正确</span>
            </div>
          </div>
          <div className="training-q-type">{q.typeName}题 {currentQ >= exercises.length && wrongQueue.length > 0 ? '· 错题重练' : ''}</div>
        </div>

        <div className="training-question" style={{ margin: '0 20px', padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'auto' }}>
          <div className="training-q-text" style={{ fontSize: 16, marginBottom: 14 }}>{q.question}</div>
          {q.typeLabel === 'choice' && (
            <div className="training-options" style={{ gap: 8 }}>
              {q.options.map((opt, i) => {
                const isSelected = selectedOption === i;
                const isCorrectOption = i === q.answer;
                let cls = 'training-option';
                if (showingResult) {
                  if (isCorrectOption) cls += ' correct';
                  else if (isSelected) cls += ' wrong';
                  cls += ' disabled';
                }
                return (
                  <div key={i} className={cls} style={{ padding: '12px 14px' }} onClick={() => !showingResult && handleChoiceAnswer(i === q.answer, i, opt)}>
                    <div className="opt-letter">{'ABCD'[i]}</div>
                    <div>{opt}</div>
                  </div>
                );
              })}
            </div>
          )}
          {q.typeLabel === 'fill' && (
            <div>
              <input className="training-fill-input" style={{ marginBottom: 8, padding: 12 }} placeholder="输入你的答案..." disabled={showingResult}
                onKeyDown={e => { if (e.key === 'Enter' && !showingResult) { const v = e.target.value; handleChoiceAnswer(v.trim().toLowerCase() === q.answer.toLowerCase(), 'fill', v); } }} />
              {showingResult && (
                <div className="training-explanation show">
                  <strong>{selectedCorrect ? '✅ 正确！' : '❌ 答错了'}</strong><br />
                  {!selectedCorrect && <>正确答案：{q.answer}<br /></>}
                  {q.explanation || ''}
                </div>
              )}
            </div>
          )}
          {q.typeLabel === 'truefalse' && (
            <div className="training-options" style={{ gap: 8 }}>
              <div className={`training-option ${showingResult ? (q.answer === true ? 'correct' : selectedOption === true ? 'wrong' : '') : ''} ${showingResult ? 'disabled' : ''}`}
                style={{ padding: '12px 14px' }} onClick={() => !showingResult && handleChoiceAnswer(true === q.answer, true, 'true')}>
                <div className="opt-letter">✓</div><div>正确</div>
              </div>
              <div className={`training-option ${showingResult ? (q.answer === false ? 'correct' : selectedOption === false ? 'wrong' : '') : ''} ${showingResult ? 'disabled' : ''}`}
                style={{ padding: '12px 14px' }} onClick={() => !showingResult && handleChoiceAnswer(false === q.answer, false, 'false')}>
                <div className="opt-letter">✗</div><div>错误</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Freeform phase ----------
  if (phase === PHASE.FREEFORM) {
    if (!freeform) {
      return (
        <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          加载问答题...
        </div>
      );
    }

    return (
      <div className="page active internalize-page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar" style={{ flexShrink: 0, paddingBottom: 4 }}>
          <div className="topbar-btn" onClick={() => navigate(-1)} style={{ fontSize: '20px' }}>‹</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>主动表达</div>
          <div onClick={handleSkipFreeform} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px', overflow: 'auto', justifyContent: 'center' }}>
          <div className="freeform-card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="freeform-tag" style={{ marginBottom: 8, padding: '3px 10px', fontSize: 11 }}>问答题</div>
            <div className="freeform-question" style={{ fontSize: 15, lineHeight: 1.45, marginBottom: 6 }}>{freeform.question}</div>
            <div className="freeform-target" style={{ fontSize: 12, opacity: 0.85 }}>知识点：{freeform.target_knowledge}</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div className="freeform-input-label" style={{ fontSize: 13, marginBottom: 6 }}>你的回答</div>
            <textarea className="freeform-textarea" placeholder="用英文写下你的回答..." value={ffInput}
              onChange={e => setFfInput(e.target.value)} maxLength={200} disabled={ffEvaluating}
              style={{ minHeight: 90, height: 90, resize: 'none' }} />
            <div className="freeform-char-count" style={{ marginTop: 4 }}>{ffInput.length}/200</div>
          </div>

          <button className="btn3d btn-primary freeform-submit-btn" onClick={handleFreeformSubmit}
            disabled={!ffInput.trim() || ffEvaluating} style={{ marginBottom: 80, padding: 14, fontSize: 15 }}>
            {ffEvaluating ? 'AI 评估中...' : '提交评估 →'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Result phase ----------
  if (phase === PHASE.RESULT) {
    const hasChoice = choiceStats.total > 0;
    const allCorrect = hasChoice && choiceStats.correct === choiceStats.total;
    return (
      <div className="page active internalize-page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="topbar" style={{ flexShrink: 0 }}>
          <div style={{ width: 40 }}></div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>内化完成</div>
          <div style={{ width: 40 }}></div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px 100px' }}>
          <div className="training-result" style={{ padding: '16px 0' }}>
            <div className="big-check">{hasChoice ? (allCorrect ? '🎉' : '✅') : '💎'}</div>
            {hasChoice ? (
              <>
                <div className="training-result-score">{choiceStats.correct}/{choiceStats.total}</div>
                <div className="training-result-label">内化完成！</div>
              </>
            ) : (
              <>
                <div className="training-result-score" style={{ fontSize: 24, marginTop: 8 }}>+闪卡回忆</div>
                <div className="training-result-label">跳过检测，内化完成</div>
              </>
            )}

            {ffResult && (
              <div className="freeform-mini-result">
                <div className="freeform-mini-score">问答题 {ffResult.evaluation?.overall_score || 0} 分</div>
                <div className="freeform-mini-suggestion">{ffResult.evaluation?.improvement || ''}</div>
              </div>
            )}

            <div className="migration-invite-card" style={{ padding: '16px 20px' }}>
              <div className="migration-invite-icon" style={{ fontSize: 28 }}>🚀</div>
              <div className="migration-invite-title" style={{ fontSize: 15 }}>试试在新场景中用出来？</div>
              <div className="migration-invite-desc" style={{ fontSize: 12, marginBottom: 12 }}>
                你已掌握基础！完成场景迁移可获得额外 <strong style={{ color: 'var(--primary)' }}>50+ XP</strong>
              </div>
              <div className="migration-invite-btns">
                <button className="btn3d btn-primary migration-invite-btn" style={{ padding: '12px 20px', fontSize: 14, maxWidth: 130 }} onClick={() => navigate(`/migration/${videoId}`)}>开始迁移 →</button>
                <button className="btn3d btn-gray migration-invite-btn" style={{ padding: '12px 20px', fontSize: 14, maxWidth: 130 }} onClick={() => navigate('/tree')}>查看矿石</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
