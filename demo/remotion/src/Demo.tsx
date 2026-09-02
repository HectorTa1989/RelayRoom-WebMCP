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
import { Highlight, type HighlightSpec } from './Highlight';
import { font, theme } from './theme';

const W = edit.wide;

/** Documentary-style lower third: chapter label above, spoken line below. */
const LowerThird: React.FC<{ index: number; chapter: string; caption: string; duration: number }> = ({
  index,
  chapter,
  caption,
  duration,
}) => {
  const frame = useCurrentFrame();
  const inOpacity = interpolate(frame, [0, 9], [0, 1], { extrapolateRight: 'clamp' });
  const outOpacity = interpolate(frame, [duration - 11, duration - 2], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rise = interpolate(frame, [0, 14], [16, 0], { extrapolateRight: 'clamp' });
  const opacity = Math.min(inOpacity, outOpacity);

  return (
    <AbsoluteFill style={{ fontFamily: font, justifyContent: 'flex-end' }}>
      <AbsoluteFill
        style={{
          opacity: opacity * 0.9,
          background: 'linear-gradient(180deg, rgba(6,7,11,0) 86%, rgba(6,7,11,0.34) 96%, rgba(6,7,11,0.6) 100%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          opacity,
          transform: `translateY(${rise}px)`,
          margin: '0 0 26px 64px',
          maxWidth: 1060,
          alignSelf: 'flex-start',
          padding: '11px 22px 13px',
          borderRadius: 15,
          background: 'rgba(8,9,14,0.88)',
          border: '1px solid rgba(255,255,255,0.13)',
          boxShadow: '0 14px 40px rgba(0,0,0,0.42)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 26,
              height: 20,
              padding: '0 7px',
              borderRadius: 6,
              background: theme.indigo,
              color: theme.white,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            style={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 2.3,
              textTransform: 'uppercase',
            }}
          >
            {chapter}
          </span>
        </div>
        <div
          style={{
            color: theme.white,
            fontSize: 29,
            lineHeight: 1.22,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          {caption}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, durationInFrames - 1], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end' }}>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.13)' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${theme.indigo}, ${theme.indigoSoft})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/** Cross-fades the opening and closing cards over the screen recording. */
const Fade: React.FC<{ mode: 'out' | 'in'; frames: number; children: React.ReactNode }> = ({
  mode,
  frames,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity =
    mode === 'out'
      ? interpolate(frame, [durationInFrames - frames, durationInFrames - 1], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : interpolate(frame, [0, frames], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const RelayRoomDemo: React.FC = () => {
  const introEnd = W.introFrames;
  const outroStart = W.introFrames + W.videoFrames;

  return (
    <AbsoluteFill style={{ background: theme.ink }}>
      <Sequence from={introEnd} durationInFrames={W.videoFrames} name="Screen recording">
        <OffthreadVideo
          src={staticFile(edit.video)}
          trimBefore={W.videoTrimBefore}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          muted
        />
      </Sequence>

      {(W.highlights as HighlightSpec[]).map((spec, index) => (
        <Sequence
          key={`hl-${index}`}
          from={spec.from}
          durationInFrames={spec.duration}
          name={`Highlight ${spec.label ?? index}`}
        >
          <AbsoluteFill>
            <Highlight spec={spec} />
          </AbsoluteFill>
        </Sequence>
      ))}

      {W.beats.map((beat) => (
        <Sequence
          key={beat.id}
          from={beat.audioFrom}
          durationInFrames={beat.audioDuration}
          name={`VO ${beat.id}`}
        >
          <Audio src={staticFile(beat.audio)} />
        </Sequence>
      ))}

      {W.beats.map((beat, index) => {
        // The caption tracks the spoken line, but never before the picture cuts in.
        const from = Math.max(beat.audioFrom, introEnd);
        const duration = Math.max(24, beat.audioFrom + beat.audioDuration + 10 - from);
        return (
          <Sequence key={`cap-${beat.id}`} from={from} durationInFrames={duration} name={`Caption ${beat.id}`}>
            <LowerThird index={index} chapter={beat.chapter} caption={beat.caption} duration={duration} />
          </Sequence>
        );
      })}

      <Sequence from={introEnd} durationInFrames={W.videoFrames} name="Progress">
        <ProgressBar />
      </Sequence>

      <Sequence from={0} durationInFrames={introEnd + 16} name="Opening card">
        <Fade mode="out" frames={16}>
          <IntroCard />
        </Fade>
      </Sequence>

      <Sequence from={outroStart - 14} durationInFrames={W.outroFrames + 14} name="Closing card">
        <Fade mode="in" frames={14}>
          <OutroCard />
        </Fade>
      </Sequence>
    </AbsoluteFill>
  );
};
