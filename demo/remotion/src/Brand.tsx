import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { font, originColors, theme } from './theme';

/** The three-bar mark from the RelayRoom header. */
export const RelayMark: React.FC<{ size?: number }> = ({ size = 64 }) => {
  const frame = useCurrentFrame();
  const bars = [0.55, 1, 0.78];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `linear-gradient(150deg, ${theme.inkSoft}, #2a2d3d)`,
        border: '1px solid rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: size * 0.075,
        padding: size * 0.22,
        boxSizing: 'border-box',
      }}
    >
      {bars.map((h, i) => {
        const pulse = 1 + 0.14 * Math.sin((frame / 14) + i * 1.1);
        return (
          <span
            key={i}
            style={{
              width: size * 0.11,
              height: size * 0.56 * h * pulse,
              borderRadius: size * 0.06,
              background: originColors[i],
            }}
          />
        );
      })}
    </div>
  );
};

/** Dark card background: dot grid, two soft colour washes, slow drift. */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 240], [0, 26], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: theme.ink, fontFamily: font }}>
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)',
          backgroundSize: '34px 34px',
          transform: `translate(${-drift}px, ${-drift * 0.4}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 620px at 16% 8%, rgba(99,91,255,0.30), transparent 62%),
                       radial-gradient(900px 560px at 92% 96%, rgba(255,159,10,0.16), transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{ background: 'linear-gradient(180deg, rgba(10,11,16,0) 55%, rgba(10,11,16,0.72) 100%)' }}
      />
    </AbsoluteFill>
  );
};

/** Three origin chips — the same idea as the app's trust bar. */
export const OriginRow: React.FC<{ opacity?: number; scale?: number }> = ({ opacity = 1, scale = 1 }) => {
  const labels = ['Atlas · buyer', 'Northstar · supplier', 'Vector · carrier'];
  return (
    <div style={{ display: 'flex', gap: 14 * scale, opacity }}>
      {labels.map((label, i) => (
        <span
          key={label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9 * scale,
            padding: `${9 * scale}px ${16 * scale}px`,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.11)',
            color: theme.muted,
            fontSize: 19 * scale,
            fontWeight: 500,
            letterSpacing: 0.1,
          }}
        >
          <i
            style={{
              width: 9 * scale,
              height: 9 * scale,
              borderRadius: 999,
              background: originColors[i],
              boxShadow: `0 0 ${12 * scale}px ${originColors[i]}`,
            }}
          />
          {label}
        </span>
      ))}
    </div>
  );
};
