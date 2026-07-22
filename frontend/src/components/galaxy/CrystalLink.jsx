/**
 * 关联边组件（单条晶链）
 * 从 frosted-crystal-garden.html 的 cl-link 迁移为 JSX
 */
import { linkPath } from './galaxyLayout.js';

export default function CrystalLink({ ax, ay, bx, by, strength, index, active }) {
  return (
    <path
      className={`cl-link${active ? ' active' : ''}`}
      d={linkPath(ax, ay, bx, by, index)}
      style={{ '--s': strength }}
    />
  );
}
