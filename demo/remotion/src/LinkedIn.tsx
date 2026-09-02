import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import edit from './data/edit.json';
import { IntroCard, OutroCard } from './Cards';
import { OriginRow, RelayMark } from './Brand';
import { Highlight, type HighlightSpec } from './Highlight';
import { font, theme } from './theme';

const L = edit.linkedin;
const HEADER_H = 170;
const STAGE_H = 830;
const SCALE = STAGE_H / edit.videoHeight;
const STAGE_VIDEO_W = edit.videoWidth * SCALE;

// How far to slide the oversized 16:9 frame so the part being talked about is
// inside the 4:5 window.
const FOCUS_LEFT: Record<string, number> = {
  wide: (L.width - STAGE_VIDEO_W) / 2,
  left: -10,
  right: L.width - STAGE_VIDEO_W,
};

// 'fit' letterboxes the whole 16:9 frame instead of cropping it. Used for the
// beat whose highlight spans the full width of the app - the trust bar gaining
// a third tool per origin - which no crop of a 4:5 frame can show intact.
const FIT_SCALE = L.width / edit.videoWidth;
const FIT_H = edit.videoHeight * FIT_SCALE;

function geometry(focus: string) {
  if (focus === 'fit') {
    return { width: L.width, height: FIT_H, left: 0, top: (STAGE_H - FIT_H) / 2, scale: FIT_SCALE, push: 1 };
  }
  return {
    width: STAGE_VIDEO_W,
    height: STAGE_H,
    left: FOCUS_LEFT[focus] ?? FOCUS_LEFT.wide,
    top: 0,
    scale: SCALE,
    push: 1.035,
  };
}

const Header: React.FC = () => (
  <div
    style={{
      height: HEADER_H,
      padding: '0 46px',
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      fontFamily: font,
    }}
  >
    <RelayMark size={54} />
    <div style={{ flex: 1 }}>
      <div style={{ color: theme.white, fontSize: 34, fontWeight: 700, letterSpacing: -0.9 }}>RelayRoom</div>
      <div style={{ color: theme.faint, fontSize: 15, fontWeight: 600, letterSpacing: 2.8 }}>
        WEBMCP · CROSS-ORIGIN RECOVERY
      </div>
    </div>
    <span
      style={{
        padding: '9px 16px',
        borderRadius: 999,
        border: '1px solid rgba(99,91,255,0.45)',
        background: 'rgba(99,91,255,0.16)',
        color: theme.indigoSoft,
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 1.8,
      }}
    >
      LIVE DEMO
    </span>
  </div>
);

const Stage: React.FC<{
  trimBefore: number;
  focus: string;
  duration: number;
  highlights: HighlightSpec[];
}> = ({ trimBefore, focus, duration, highlights }) => {
  const frame = useCurrentFrame();
  const geo = geometry(focus);
  // A slow push keeps a static screen recording from feeling frozen.
  const zoom = interpolate(frame, [0, duration], [1, geo.push], { extrapolateRight: 'clamp' });
  const slide = focus === 'fit' ? 0 : interpolate(frame, [0, duration], [0, -14], { extrapolateRight: 'clamp' });
  // Clamped so the drift can never expose the container behind the frame.
  const left = focus === 'fit'
    ? geo.left
    : Math.min(0, Math.max(L.width - STAGE_VIDEO_W, geo.left + slide));

  return (
    <div
      style={{
        height: STAGE_H,
        overflow: 'hidden',
        position: 'relative',
        background: focus === 'fit' ? theme.ink : theme.paper,
        borderTop: '1px solid rgba(255,255,255,0.09)',
        borderBottom: '1px solid rgba(255,255,255,0.09)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left,
          top: geo.top,
          width: geo.width,
          height: geo.height,
          transform: `scale(${zoom})`,
          transformOrigin: 'center',
        }}
      >
        <OffthreadVideo
          src={staticFile(edit.video)}
          trimBefore={trimBefore}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          muted
        />
        {highlights.map((spec, index) => (
          <Sequence
            key={`hl-${index}`}
            from={spec.from}
            durationInFrames={spec.duration}
            layout="none"
            name={`Highlight ${spec.label ?? index}`}
          >
            <Highlight spec={spec} scale={geo.scale} />
          </Sequence>
        ))}
      </div>
    </div>
  );
};

const Caption: React.FC<{ text: string; duration: number }> = ({ text, duration }) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const leave = interpolate(frame, [duration - 10, duration - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        flex: 1,
        padding: '38px 46px 0',
        fontFamily: font,
        opacity: Math.min(appear, leave),
        transform: `translateY(${(1 - appear) * 14}px)`,
      }}
    >
      <div
        style={{
          color: theme.white,
          fontSize: 42,
          lineHeight: 1.26,
          fontWeight: 650,
          letterSpacing: -1.1,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Footer: React.FC = () => (
  <div style={{ padding: '0 46px 34px', fontFamily: font }}>
    <OriginRow scale={0.94} opacity={0.85} />
  </div>
);

const FadeOut: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [durationInFrames - frames, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const RelayRoomLinkedIn: React.FC = () => (
  <AbsoluteFill style={{ background: theme.ink }}>
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 620px at 20% 0%, rgba(99,91,255,0.26), transparent 60%),
                     radial-gradient(760px 560px at 90% 100%, rgba(255,159,10,0.14), transparent 60%)`,
      }}
    />

    {L.beats.map((beat) => (
      <Sequence key={beat.id} from={beat.from} durationInFrames={beat.duration} name={beat.id}>
        {beat.trimBefore === null ? (
          <OutroCard compact />
        ) : (
          <AbsoluteFill style={{ flexDirection: 'column' }}>
            <Header />
            <Stage
              trimBefore={beat.trimBefore}
              focus={beat.focus}
              duration={beat.duration}
              highlights={(beat.highlights ?? []) as HighlightSpec[]}
            />
            <Caption text={beat.caption} duration={beat.duration} />
            <Footer />
          </AbsoluteFill>
        )}
        <Audio src={staticFile(beat.audio)} />
      </Sequence>
    ))}

    <Sequence from={0} durationInFrames={L.introFrames + 12} name="Opening card">
      <FadeOut frames={12}>
        <IntroCard compact />
      </FadeOut>
    </Sequence>
  </AbsoluteFill>
);
