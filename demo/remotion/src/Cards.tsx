import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, OriginRow, RelayMark } from './Brand';
import { font, theme } from './theme';

const useReveal = (delay: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7 } });
  return { opacity: s, transform: `translateY(${(1 - s) * 26}px)` };
};

export const IntroCard: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const k = compact ? 0.62 : 1;
  const mark = useReveal(0);
  const kicker = useReveal(4);
  const title = useReveal(8);
  const sub = useReveal(14);
  const chips = useReveal(20);

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{
          fontFamily: font,
          padding: compact ? '0 74px' : '0 150px',
          justifyContent: 'center',
          gap: 30 * k,
        }}
      >
        <div style={{ ...mark, display: 'flex', alignItems: 'center', gap: 22 * k }}>
          <RelayMark size={76 * k} />
          <div>
            <div style={{ color: theme.white, fontSize: 46 * k, fontWeight: 700, letterSpacing: -1 * k }}>
              RelayRoom
            </div>
            <div style={{ color: theme.faint, fontSize: 17 * k, letterSpacing: 3.4 * k, fontWeight: 600 }}>
              CROSS-ORIGIN RECOVERY
            </div>
          </div>
        </div>

        <div
          style={{
            ...kicker,
            alignSelf: 'flex-start',
            padding: `${8 * k}px ${18 * k}px`,
            borderRadius: 999,
            border: '1px solid rgba(99,91,255,0.45)',
            background: 'rgba(99,91,255,0.14)',
            color: theme.indigoSoft,
            fontSize: 18 * k,
            fontWeight: 700,
            letterSpacing: 2.6 * k,
          }}
        >
          BUILT ON WEBMCP
        </div>

        <h1
          style={{
            ...title,
            margin: 0,
            color: theme.white,
            fontSize: (compact ? 82 : 96) * (compact ? 1 : 1),
            lineHeight: 1.03,
            fontWeight: 700,
            letterSpacing: compact ? -2.6 : -3.6,
            maxWidth: compact ? 940 : 1320,
          }}
        >
          One disruption.
          <br />
          Three companies.
          <br />
          <span style={{ color: theme.indigoSoft }}>One coordinated fix.</span>
        </h1>

        <p
          style={{
            ...sub,
            margin: 0,
            color: theme.muted,
            fontSize: (compact ? 27 : 30) * 1,
            lineHeight: 1.5,
            maxWidth: compact ? 900 : 1080,
            fontWeight: 400,
          }}
        >
          A buyer, a supplier and a carrier stay independent websites — with their own state, their own
          APIs and their own origin allowlists.
        </p>

        <div style={chips}>
          <OriginRow scale={compact ? 1.05 : 1.25} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const CLOSING_POINTS = [
  'Cross-origin tool discovery',
  'Human approval gate',
  'Ordered commit + rollback',
  'Origin-labelled audit receipt',
];

export const OutroCard: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const frame = useCurrentFrame();
  const k = compact ? 0.66 : 1;
  const line = useReveal(2);
  const rule = useReveal(10);
  const foot = useReveal(compact ? 14 : 30);

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{
          fontFamily: font,
          padding: compact ? '0 74px' : '0 150px',
          justifyContent: 'center',
          gap: compact ? 34 : 38,
        }}
      >
        <h1
          style={{
            ...line,
            margin: 0,
            color: theme.white,
            fontSize: compact ? 52 : 78,
            lineHeight: 1.1,
            fontWeight: 700,
            letterSpacing: compact ? -1.9 : -2.6,
            maxWidth: compact ? 940 : 1420,
          }}
        >
          Independent websites cooperating
          <br />
          <span style={{ color: theme.indigoSoft }}>without surrendering control.</span>
        </h1>

        <div style={{ ...rule, display: 'flex', flexWrap: 'wrap', gap: 12 * k, maxWidth: compact ? 920 : 1500 }}>
          {CLOSING_POINTS.map((point, i) => {
            const s = interpolate(frame - (compact ? 12 : 16) - i * 4, [0, 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <span
                key={point}
                style={{
                  opacity: s,
                  transform: `translateY(${(1 - s) * 12}px)`,
                  padding: `${11 * k}px ${20 * k}px`,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.055)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.82)',
                  fontSize: 22 * k,
                  fontWeight: 500,
                }}
              >
                {point}
              </span>
            );
          })}
        </div>

        <div
          style={{
            ...foot,
            display: 'flex',
            alignItems: 'center',
            gap: 18 * k,
            color: theme.faint,
            fontSize: 22 * k,
          }}
        >
          <RelayMark size={44 * k} />
          <span style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 600 }}>RelayRoom</span>
          <span>·</span>
          <span>github.com/HectorTa1989</span>
          <span>·</span>
          <span>MIT</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
