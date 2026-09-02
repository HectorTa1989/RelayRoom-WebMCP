import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { font, theme } from './theme';

export type Rect = { x: number; y: number; width: number; height: number };
export type HighlightSpec = {
  tone: string;
  label?: string;
  rects: Rect[];
  from: number;
  duration: number;
};

const TONES: Record<string, { line: string; glow: string; chip: string; text: string }> = {
  change: { line: theme.indigo, glow: 'rgba(99,91,255,0.45)', chip: theme.indigo, text: '#ffffff' },
  success: { line: theme.mint, glow: 'rgba(52,199,89,0.42)', chip: '#1f9d43', text: '#ffffff' },
  attention: { line: theme.amber, glow: 'rgba(255,159,10,0.42)', chip: '#c9760a', text: '#ffffff' },
  fail: { line: '#ff3b30', glow: 'rgba(255,59,48,0.42)', chip: '#d92c22', text: '#ffffff' },
};

/**
 * Draws a ring around a region of the recording that just changed state, using
 * the element rectangle the capture script measured at that exact moment.
 * `scale` maps source-video pixels into whatever box the picture is drawn in,
 * so the same data works for the 16:9 film and the cropped 4:5 cut.
 */
export const Highlight: React.FC<{ spec: HighlightSpec; scale?: number }> = ({ spec, scale = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tone = TONES[spec.tone] ?? TONES.change;

  const grow = spring({ frame, fps, config: { damping: 200, mass: 0.5 } });
  const fadeIn = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [spec.duration - 9, spec.duration - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(fadeIn, fadeOut);
  // A slow breathing pulse so the ring reads as live rather than as a static
  // annotation stamped on the frame.
  const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(frame / 6.5));

  return (
    <>
      {spec.rects.map((raw, index) => {
        const r = {
          x: raw.x * scale,
          y: raw.y * scale,
          width: raw.width * scale,
          height: raw.height * scale,
        };
        const stagger = interpolate(grow, [0, 1], [1.055, 1]);
        const delay = interpolate(frame - index * 3, [0, 8], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const labelBelow = r.y < 150 * scale;

        return (
          <div key={index} style={{ position: 'absolute', inset: 0, opacity: opacity * delay }}>
            <div
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y,
                width: r.width,
                height: r.height,
                border: `${Math.max(2, 3 * scale)}px solid ${tone.line}`,
                borderRadius: 14 * scale,
                boxShadow: `0 0 ${26 * scale}px ${tone.glow}, inset 0 0 ${18 * scale}px ${tone.glow}`,
                transform: `translate(${cx * (1 - stagger)}px, ${cy * (1 - stagger)}px) scale(${stagger})`,
                transformOrigin: '0 0',
                opacity: pulse,
              }}
            />
            {spec.label && index === 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: r.x,
                  top: labelBelow ? r.y + r.height + 11 * scale : r.y - 15 * scale,
                  transform: labelBelow ? 'none' : 'translateY(-100%)',
                  fontFamily: font,
                  fontSize: Math.max(17, 21 * scale),
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  color: tone.text,
                  background: tone.chip,
                  padding: `${Math.max(6, 7 * scale)}px ${Math.max(11, 14 * scale)}px`,
                  borderRadius: 9 * scale,
                  whiteSpace: 'nowrap',
                  boxShadow: `0 ${8 * scale}px ${22 * scale}px rgba(0,0,0,0.35)`,
                }}
              >
                {spec.label}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
