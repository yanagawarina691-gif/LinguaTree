/**
 * CenterLoader — 居中的极简加载页
 * 三种 sprite 动画随机选一个 + 文字
 */
import { useMemo } from 'react';

const ANIMATIONS = [
  '/assets/animation.gif',
  '/assets/animation-1.gif',
  '/assets/animation-2.gif',
];

export default function CenterLoader({ text = '加载中...', spriteKey }) {
  // 用 useMemo + spriteKey 锁定同一个 sprite（同一加载态不闪烁）
  // 没传 spriteKey 时随机一个
  const src = useMemo(() => {
    if (spriteKey !== undefined) return ANIMATIONS[spriteKey % ANIMATIONS.length];
    return ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)];
  }, [spriteKey]);

  return (
    <div className="center-loader">
      <img src={src} alt="loading" className="center-loader-gif" />
      <div className="center-loader-text">{text}</div>
    </div>
  );
}
