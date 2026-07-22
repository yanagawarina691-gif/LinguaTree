/**
 * SVG <defs> 滤镜和渐变定义（从 frosted-crystal-garden.html 原样迁移为 JSX）
 * 包含：噪点纹理、地面渐变、玻璃路径渐变、霜冻滤镜、辉光滤镜
 */
export default function CrystalDefs() {
  return (
    <defs>
      {/* 噪点纹理 */}
      <pattern id="cl-grain" width="54" height="54" patternUnits="userSpaceOnUse">
        <circle cx="9" cy="15" r=".8" fill="var(--muted-foreground)" opacity=".12" />
        <circle cx="39" cy="37" r="1.1" fill="var(--viz-series-3)" opacity=".1" />
        <path d="M0 53Q18 44 34 51T54 48" fill="none" stroke="var(--border)" opacity=".08" />
      </pattern>

      {/* 地面渐变 */}
      <linearGradient id="cl-ground" x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#F8FAFB" />
        <stop offset=".46" stopColor="#D8ECF3" />
        <stop offset="1" stopColor="#F1F6F8" />
      </linearGradient>

      {/* 玻璃路径渐变 A */}
      <linearGradient id="cl-glass-a" x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#40F2FB" stopOpacity=".15" />
        <stop offset=".62" stopColor="#78DEF9" stopOpacity=".09" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity=".02" />
      </linearGradient>

      {/* 玻璃路径渐变 B */}
      <linearGradient id="cl-glass-b" x1="1" y1="0" x2="0" y2="1">
        <stop stopColor="#FE8BF2" stopOpacity=".12" />
        <stop offset=".55" stopColor="#FCD90B" stopOpacity=".05" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity=".02" />
      </linearGradient>

      {/* 霜冻扭曲滤镜 */}
      <filter id="cl-frost" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".018 .22" numOctaves="3" seed="43" result="frostNoise" />
        <feColorMatrix in="frostNoise" type="matrix" values="1 0 0 0 .72  0 1 0 0 .84  0 0 1 0 .92  0 0 0 .32 0" result="frostColor" />
        <feDisplacementMap in="SourceGraphic" in2="frostNoise" scale="9" xChannelSelector="R" yChannelSelector="G" result="warped" />
        <feBlend in="warped" in2="frostColor" mode="screen" />
      </filter>

      {/* 晶核径向渐变 */}
      <radialGradient id="cl-core">
        <stop offset="0" stopColor="var(--primary-foreground)" stopOpacity="1" />
        <stop offset=".18" stopColor="currentColor" stopOpacity=".95" />
        <stop offset=".62" stopColor="currentColor" stopOpacity=".34" />
        <stop offset="1" stopColor="currentColor" stopOpacity="0" />
      </radialGradient>

      {/* 噪点纹理滤镜 */}
      <filter id="cl-noise" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="31" result="n" />
        <feColorMatrix in="n" type="saturate" values="0" result="m" />
        <feBlend in="SourceGraphic" in2="m" mode="soft-light" />
      </filter>

      {/* 低辉光 */}
      <filter id="cl-glow-low" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* 中辉光 */}
      <filter id="cl-glow-mid" x="-180%" y="-180%" width="460%" height="460%">
        <feGaussianBlur stdDeviation="11" result="b1" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b2" />
        <feMerge>
          <feMergeNode in="b1" />
          <feMergeNode in="b2" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* 高辉光 */}
      <filter id="cl-glow-high" x="-240%" y="-240%" width="580%" height="580%">
        <feGaussianBlur stdDeviation="20" result="b1" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b2" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b3" />
        <feMerge>
          <feMergeNode in="b1" />
          <feMergeNode in="b2" />
          <feMergeNode in="b3" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
