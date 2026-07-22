import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { parseVideo, getVideoStatus, getVideoList } from '../api/videos.js';

const PARSE_STEPS = [
  { icon: '🎬', name: '获取视频信息', desc: '下载视频、提取音频和关键帧' },
  { icon: '🎤', name: 'ASR 语音转写', desc: '识别视频中的语音内容' },
  { icon: '📝', name: 'OCR 文字识别', desc: '识别画面中的板书和字幕' },
  { icon: '👁️', name: 'VLM 画面理解', desc: '分析画面场景和教学动作' },
  { icon: '🧠', name: 'LLM 知识点抽取', desc: '映射到知识树节点 + 生成训练题' },
];

export default function FeedPage() {
  const [link, setLink] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseSteps, setParseSteps] = useState([]);
  const [videos, setVideos] = useState([]);
  const { user } = useAuth();
  const navigate = useNavigate();

  const loadVideos = useCallback(async () => {
    try {
      const list = await getVideoList();
      setVideos(list);
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const isUrl = (str) => {
    return /^https?:\/\//i.test(str) || /^www\./i.test(str);
  };

  const startParse = async () => {
    if (!link.trim()) { showToast('请先粘贴视频链接或文字稿'); return; }
    setParsing(true);
    setParseSteps(PARSE_STEPS.map((s, i) => ({ ...s, idx: i, status: 'pending' })));

    try {
      const input = link.trim();
      const result = isUrl(input)
        ? await parseVideo(input)
        : await parseVideo('', input);
      const videoId = result.videoId;

      // Poll for status
      for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const status = await getVideoStatus(videoId);

        // Update step visuals based on logs
        if (status.logs) {
          setParseSteps(prev => prev.map(s => {
            const log = status.logs.find(l => l.stage && l.stage.includes(s.name.substring(0, 3)));
            if (log) return { ...s, status: log.status === 'done' ? 'done' : 'active' };
            return s;
          }));
        }

        if (status.status === 'done') {
          setParseSteps(prev => prev.map(s => ({ ...s, status: 'done' })));
          await sleep(800);
          setParsing(false);
          navigate(`/deepen/${videoId}`);
          return;
        }
        if (status.status === 'error') {
          throw new Error(status.error_message || '解析失败');
        }
      }
      throw new Error('解析超时');
    } catch (err) {
      showToast(err.message);
      setParsing(false);
    }
  };

  const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
  };

  return (
    <div className="page active">
      <div className="topbar">
        <div className="topbar-logo">
          <svg width="28" height="28" viewBox="0 0 32 32"><path d="M16 2C8 2 4 10 4 16c0 8 6 14 12 14s12-6 12-14c0-6-4-14-12-14z" fill="#58CC02"/><path d="M16 6v22M16 12l-4-3M16 12l4-3M16 18l-5-4M16 18l5-4" stroke="#46A302" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>
          LinguaTree
        </div>
        <div className="topbar-actions">
          <div className="topbar-btn" onClick={() => navigate('/tree')}>🌳</div>
          <div className="topbar-avatar" onClick={() => navigate('/me')}>{user?.nickname?.[0] || '?'}</div>
        </div>
      </div>

      <div className="feed-hero">
        <img src="/assets/mascot-tree.png" width="80" height="80" style={{ objectFit: 'contain', margin: '0 auto 8px', display: 'block' }} alt="mascot" />
        <h1>刷视频，种知识树</h1>
        <p>粘贴抖音英语视频链接，AI 自动解析知识点</p>
      </div>

      <div className="link-input-wrap">
        <div className="link-input-card">
          <div className="link-input-row">
            <input type="text" value={link} onChange={e => setLink(e.target.value)} placeholder="粘贴抖音视频链接，或输入文字稿..." />
            <div className="paste-btn" onClick={async () => { try { const t = await navigator.clipboard.readText(); setLink(t); } catch(e) { showToast('请手动粘贴'); } }}>📋</div>
          </div>
          <button className="btn3d btn-primary" style={{ width: '100%', marginTop: 12, padding: 14, fontSize: 16 }} onClick={startParse} disabled={parsing}>
            {parsing ? '解析中...' : '🚀 开始解析'}
          </button>
        </div>
      </div>

      {parsing && (
        <div className="parse-status">
          <div className="parse-card">
            <div className="parse-title">🔍 AI 正在解析视频...</div>
            <div className="parse-steps">
              {parseSteps.map((s, i) => (
                <div key={i} className={`parse-step ${s.status === 'active' ? 'active' : ''} ${s.status === 'done' ? 'done' : ''}`}>
                  <div className="parse-step-icon">{s.status === 'done' ? '✓' : s.icon}</div>
                  <div className="parse-step-text">
                    <div className="parse-step-name">{s.name}</div>
                    <div className="parse-step-desc">{s.desc}</div>
                  </div>
                  {s.status === 'active' && <div className="parse-spinner"></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="video-section">
        <div className="section-title">最近解析 <span className="count">{videos.length} 条</span></div>
        {videos.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-lt)', padding: 32, fontSize: 14 }}>还没有解析过视频，粘贴链接开始吧</p>
        ) : (
          videos.map(v => (
            <div key={v.id} className="video-card" onClick={() => navigate(`/deepen/${v.id}`)}>
              <div className="video-thumb"><span className="play-icon">▶</span></div>
              <div className="video-info">
                <div className="video-title">{v.title || '未命名视频'}</div>
                <div className="video-tags">
                  {v.cefr_level && <span className="video-tag tag-grammar">{v.cefr_level}</span>}
                  <span className="video-tag tag-listen">{v.status}</span>
                </div>
                {v.summary && <div style={{ fontSize: 12, color: 'var(--text-lt)', marginTop: 4, lineHeight: 1.4 }}>{v.summary}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
