import { useState, useEffect, useCallback } from 'react';
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

  const loadVideo = useCallback(async () => {
    try {
      const data = await getVideoDetail(videoId);
      if (data.status !== 'done') {
        setError('视频还在解析中...');
        setLoading(false);
        return;
      }
      setVideo(data);
      const exList = [];
      if (data.exercises?.choice) exList.push({ ...data.exercises.choice, typeLabel: 'choice', typeName: '选择' });
      if (data.exercises?.fill) exList.push({ ...data.exercises.fill, typeLabel: 'fill', typeName: '填空' });
      if (data.exercises?.judge) exList.push({ ...data.exercises.judge, typeLabel: 'truefalse', typeName: '判断' });
      setExercises(exList);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => { loadVideo(); }, [loadVideo]);

  const handleAnswer = async (isCorrect, isSkipped, userAnswer) => {
    const q = exercises[currentQ];
    const newAttempt = {
      exerciseId: q.id,
      nodeId: q.node_id,
      isCorrect,
      isSkipped,
      userAnswer: String(userAnswer),
    };
    const newAttempts = [...attempts, newAttempt];
    setAttempts(newAttempts);

    if (isCorrect) setCorrectCount(c => c + 1);

    setTimeout(async () => {
      if (currentQ < exercises.length - 1) {
        setCurrentQ(c => c + 1);
      } else {
        // All done — submit
        try {
          const result = await completeExercises(videoId, newAttempts);
          setXpGained(result.treeUpdate?.totalXp || 0);
          setShowResult(true);
        } catch (err) {
          setXpGained(40);
          setShowResult(true);
        }
      }
    }, 2500);
  };

  if (loading) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>加载题目...</div>;
  if (error) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-lt)' }}>{error}</div>;
  if (!video || exercises.length === 0) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>暂无题目</div>;

  if (showResult) {
    return (
      <div className="page active training-page">
        <div className="training-result">
          <div className="big-check">{correctCount === exercises.length ? '🎉' : '✅'}</div>
          <div className="training-result-score">{correctCount}/{exercises.length}</div>
          <div className="training-result-label">获得 {xpGained} XP</div>
          <button className="btn3d btn-primary" style={{ padding: '16px 40px', fontSize: 16, marginTop: 8 }} onClick={() => navigate('/')}>完成</button>
        </div>
      </div>
    );
  }

  const q = exercises[currentQ];

  return (
    <div className="page active training-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate('/')} style={{ fontSize: '20px' }}>‹</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>巩固训练</div>
        <div onClick={() => handleAnswer(false, true, '')} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-lt)', cursor: 'pointer' }}>跳过</div>
      </div>

      <div className="training-header">
        <div className="training-progress">
          {exercises.map((_, i) => (
            <div key={i} className={`progress-dot ${i === currentQ ? 'active' : ''} ${i < currentQ ? 'done' : ''}`}></div>
          ))}
        </div>
        <div className="training-q-type">{q.typeName}题 · {currentQ + 1}/{exercises.length}</div>
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
            <input className="training-fill-input" placeholder="输入你的答案..." onKeyDown={e => { if (e.key === 'Enter') { const val = e.target.value; const correct = val.trim().toLowerCase() === q.answer.toLowerCase(); e.target.style.borderColor = correct ? 'var(--primary)' : 'var(--red)'; const exp = document.getElementById('exp'); if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>正确答案：${q.answer}<br>${q.explanation || ''}`; exp.classList.add('show'); } handleAnswer(correct, false, val); } }} />
            <div className="training-explanation" id="exp"></div>
          </>
        )}
        {q.typeLabel === 'truefalse' && (
          <div className="training-options">
            <div className="training-option" onClick={() => { const opts = document.querySelectorAll('.training-option'); opts.forEach(o => o.classList.add('disabled')); const correct = true === q.answer; opts[0].classList.add(correct ? 'correct' : 'wrong'); if (!correct) opts[1].classList.add('correct'); const exp = document.getElementById('exp'); if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>${q.explanation || ''}`; exp.classList.add('show'); } handleAnswer(correct, false, true); }}><div className="opt-letter">✓</div><div>正确</div></div>
            <div className="training-option" onClick={() => { const opts = document.querySelectorAll('.training-option'); opts.forEach(o => o.classList.add('disabled')); const correct = false === q.answer; opts[1].classList.add(correct ? 'correct' : 'wrong'); if (!correct) opts[0].classList.add('correct'); const exp = document.getElementById('exp'); if (exp) { exp.innerHTML = `<strong>${correct ? '✅ 正确！' : '❌ 答错了'}</strong><br>${q.explanation || ''}`; exp.classList.add('show'); } handleAnswer(correct, false, false); }}><div className="opt-letter">✗</div><div>错误</div></div>
          </div>
        )}
        {q.typeLabel !== 'fill' && <div className="training-explanation" id="exp"></div>}
      </div>
    </div>
  );
}
