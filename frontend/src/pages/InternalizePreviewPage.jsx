import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getVideoDetail, getFlashcards, getFreeformQuestion } from '../api/videos.js';
import CenterLoader from '../components/CenterLoader.jsx';
import TopBar from '../components/TopBar.jsx';

function answerText(exercise) {
  if (exercise.type === 'choice' && Array.isArray(exercise.options)) {
    return exercise.options[exercise.answer] ?? String(exercise.answer ?? '');
  }
  if (typeof exercise.answer === 'boolean') return exercise.answer ? '正确' : '错误';
  return String(exercise.answer ?? '');
}

// Separate from the interactive trainer: no timers, attempts, grading or completion effects.
export default function InternalizePreviewPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    setCardIndex(0);
    setFlipped(false);
    Promise.all([getVideoDetail(videoId), getFlashcards(videoId), getFreeformQuestion(videoId)])
      .then(([video, flashcards, freeform]) => {
        if (active) setData({ video, cards: flashcards.flashcards || [], freeform });
      })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [videoId]);

  if (error) return (
    <div className="page active">
      <TopBar title="内化练习示例" />
      <div className="demo-empty" role="alert">
        <p>{error}</p>
        <button className="btn3d btn-gray" onClick={() => navigate(`/deepen/${videoId}`)}>返回讲解</button>
      </div>
    </div>
  );
  if (!data) return <div className="page active"><CenterLoader text="加载预生成练习..." spriteKey={1} /></div>;

  const card = data.cards[cardIndex];
  const exercises = ['choice', 'fill', 'judge']
    .filter(type => data.video.exercises?.[type])
    .map(type => ({ ...data.video.exercises[type], type }));

  return (
    <div className="page active internalize-page demo-preview-page">
      <TopBar title="内化练习示例" />
      <div className="demo-preview-content">
        <p className="demo-inline-note">浏览闪卡、题目和参考答案。这里不会记录掌握度、评分或学习进度。</p>
        <section className="demo-preview-section" aria-labelledby="demo-flashcard-heading">
          <h2 id="demo-flashcard-heading">🃏 闪卡回忆</h2>
          {card ? <>
            <button className="demo-flashcard" onClick={() => setFlipped(value => !value)} aria-pressed={flipped}>
              <span className="demo-inline-note">{flipped ? '释义 / 示例' : '英文表达'} · {cardIndex + 1}/{data.cards.length}</span>
              <span className="demo-flashcard-text">{flipped ? card.back : card.front}</span>
              <span className="demo-inline-note">点击{flipped ? '返回正面' : '查看释义'}</span>
            </button>
            <div className="demo-navigation">
              <button className="btn3d btn-gray" disabled={cardIndex === 0} onClick={() => { setCardIndex(i => i - 1); setFlipped(false); }}>上一张</button>
              <button className="btn3d btn-primary" disabled={cardIndex >= data.cards.length - 1} onClick={() => { setCardIndex(i => i + 1); setFlipped(false); }}>下一张</button>
            </div>
          </> : <p className="demo-inline-note">此课程暂无示例闪卡。</p>}
        </section>

        <section className="demo-preview-section" aria-labelledby="demo-exercises-heading">
          <h2 id="demo-exercises-heading">✏️ 巩固题目</h2>
          {exercises.map((exercise, index) => (
            <article className="demo-exercise" key={exercise.id || exercise.type}>
              <h3>{index + 1}. {exercise.question}</h3>
              {Array.isArray(exercise.options) && <ol className="demo-options" type="A">
                {exercise.options.map((option, i) => <li key={i}>{option}</li>)}
              </ol>}
              <details className="demo-answer">
                <summary>查看参考答案</summary>
                <p>{answerText(exercise)}</p>
                {exercise.explanation && <p>{exercise.explanation}</p>}
              </details>
            </article>
          ))}
          {!exercises.length && <p className="demo-inline-note">此课程暂无示例题目。</p>}
        </section>

        {data.freeform?.question && <section className="demo-preview-section" aria-labelledby="demo-freeform-heading">
          <h2 id="demo-freeform-heading">💬 主动表达</h2>
          <div className="freeform-card">
            <div className="freeform-question">{data.freeform.question}</div>
            <div className="freeform-target">知识点：{data.freeform.target_knowledge}</div>
          </div>
          {data.freeform.sample_answer && <details className="demo-answer">
            <summary>查看参考表达（预生成）</summary>
            <p>{data.freeform.sample_answer}</p>
          </details>}
        </section>}
        <div className="demo-navigation">
          <button className="btn3d btn-gray" onClick={() => navigate(`/deepen/${videoId}`)}>返回讲解</button>
          <button className="btn3d btn-primary" onClick={() => navigate(`/migration/${videoId}`)}>浏览迁移场景 →</button>
        </div>
      </div>
    </div>
  );
}
