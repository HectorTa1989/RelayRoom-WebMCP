/**
 * Copies the recorded capture and the narration clips into the Remotion
 * project's public folder, then derives one edit plan that both compositions
 * read. Everything downstream is a pure function of these numbers, so the film
 * stays in sync no matter how long the recorded take turns out to be.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');
const ASSETS = path.join(DEMO, 'assets');
const REMOTION = path.join(DEMO, 'remotion');
const PUBLIC = path.join(REMOTION, 'public');
const DATA = path.join(REMOTION, 'src', 'data');

const FPS = 30;
const INTRO_SEC = 3.6;          // branded opening card
const INTRO_VO_LEAD = 1.15;     // first line starts while the card is still up
const OUTRO_SEC = 4.2;          // closing card on the wide film
const TAIL_SEC = 0.5;           // breathing room after the last beat
const LI_INTRO_SEC = 2.4;
const LI_PAD_SEC = 0.35;        // extra picture after each LinkedIn line

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const frames = (sec) => Math.round(sec * FPS);

function copyInto(from, toDir, name) {
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(from, path.join(toDir, name ?? path.basename(from)));
}

const timeline = read(path.join(ASSETS, 'capture', 'timeline.json'));
const wide = read(path.join(ASSETS, 'audio', 'manifest.json'));
const linkedin = read(path.join(ASSETS, 'audio-linkedin', 'manifest.json'));

// The manifests carry measured audio durations; the narration scripts stay the
// source of truth for editorial fields. Reading anchors and captions from the
// script means retiming a clip does not require re-synthesising its voiceover.
const liScript = read(path.join(DEMO, 'scripts', 'narration-linkedin.json'));
const liEdits = new Map(liScript.beats.map((b) => [b.id, b]));

// Playwright's screencast clock runs a hair slower than wall clock. Every
// wall-clock instant the capture script logged maps to source video seconds
// through this ratio.
const ratio = timeline.clockDriftRatio;
const srcAt = (wallSec) => (timeline.firstVisibleSec + wallSec) * ratio;
const srcOrigin = srcAt(0);

const wideBeats = wide.beats.map((beat) => {
  const shot = timeline.beats.find((b) => b.id === beat.id);
  if (!shot) throw new Error(`no captured shot for narration beat ${beat.id}`);
  const stageSec = INTRO_SEC + srcAt(shot.startSec) - srcOrigin;
  return {
    id: beat.id,
    chapter: beat.chapter,
    caption: beat.caption,
    audio: beat.file.replace(/\\/g, '/'),
    audioFrom: frames(beat.id === wide.beats[0].id ? INTRO_VO_LEAD : stageSec),
    audioDuration: frames(beat.duration),
    shotFrom: frames(stageSec),
    shotDuration: frames(srcAt(shot.endSec) - srcAt(shot.startSec)),
  };
});

// Status highlights. The capture recorded each rectangle in page CSS pixels at
// a wall-clock instant; both are mapped into the same space the picture uses.
const cssScale = timeline.cssScale ?? 1;
const scaleRect = (r) => ({
  x: Math.round(r.x * cssScale),
  y: Math.round(r.y * cssScale),
  width: Math.round(r.width * cssScale),
  height: Math.round(r.height * cssScale),
});

const marks = (timeline.marks ?? []).map((m) => ({
  tone: m.tone,
  label: m.label,
  rects: m.rects.map(scaleRect),
  srcFrame: frames(srcAt(m.atSec)),
  stageFrom: frames(INTRO_SEC + srcAt(m.atSec) - srcOrigin),
  duration: frames(m.holdSec),
}));

const lastShot = timeline.beats[timeline.beats.length - 1];
const videoDurationFrames = frames(srcAt(lastShot.endSec + TAIL_SEC) - srcOrigin);
const wideTotal = frames(INTRO_SEC) + videoDurationFrames + frames(OUTRO_SEC);

// LinkedIn clips point at a beat or at a named status mark rather than an
// absolute timestamp, so re-capturing never silently retimes the cut.
function resolveAnchor(anchor, id) {
  if (!anchor) return null;
  const { offset = 0 } = anchor;
  if (anchor.beat) {
    const shot = timeline.beats.find((b) => b.id === anchor.beat);
    if (!shot) throw new Error(`LinkedIn clip ${id} anchors to unknown beat ${anchor.beat}`);
    return shot.startSec + offset;
  }
  if (anchor.mark) {
    const hit = (timeline.marks ?? []).find((m) => m.label === anchor.mark);
    if (!hit) throw new Error(`LinkedIn clip ${id} anchors to unknown mark "${anchor.mark}"`);
    return hit.atSec + offset;
  }
  throw new Error(`LinkedIn clip ${id} has an anchor with neither beat nor mark`);
}

let cursor = frames(LI_INTRO_SEC);
const liBeats = linkedin.beats.map((beat) => {
  const duration = frames(beat.duration + LI_PAD_SEC);
  const edits = liEdits.get(beat.id) ?? beat;
  const anchorWall = resolveAnchor(edits.anchor, beat.id);
  const entry = {
    id: beat.id,
    caption: edits.caption ?? beat.caption,
    focus: edits.focus ?? beat.focus ?? 'wide',
    audio: beat.file.replace(/\\/g, '/'),
    from: cursor,
    duration,
    // A clip with no anchor is narrated over the closing card instead.
    trimBefore: anchorWall === null ? null : frames(srcAt(anchorWall)),
  };
  // Carry over any status highlight that falls inside this clip's slice of the
  // source, re-timed to the clip.
  entry.highlights = entry.trimBefore === null ? [] : marks
    .filter((m) => m.srcFrame >= entry.trimBefore && m.srcFrame < entry.trimBefore + duration)
    .map((m) => ({
      tone: m.tone,
      label: m.label,
      rects: m.rects,
      from: m.srcFrame - entry.trimBefore,
      duration: Math.min(m.duration, entry.trimBefore + duration - m.srcFrame),
    }));
  cursor += duration;
  return entry;
});

const edit = {
  fps: FPS,
  video: timeline.video,
  videoWidth: timeline.videoWidth,
  videoHeight: timeline.videoHeight,
  wide: {
    width: 1920,
    height: 1080,
    introFrames: frames(INTRO_SEC),
    videoFrames: videoDurationFrames,
    videoTrimBefore: frames(srcOrigin),
    outroFrames: frames(OUTRO_SEC),
    totalFrames: wideTotal,
    beats: wideBeats,
    highlights: marks.map(({ tone, label, rects, stageFrom, duration }) => ({
      tone, label, rects, from: stageFrom, duration,
    })),
  },
  linkedin: {
    width: 1080,
    height: 1350,
    introFrames: frames(LI_INTRO_SEC),
    totalFrames: cursor,
    beats: liBeats,
  },
};

fs.rmSync(path.join(PUBLIC, 'audio'), { recursive: true, force: true });
fs.rmSync(path.join(PUBLIC, 'audio-linkedin'), { recursive: true, force: true });
copyInto(path.join(ASSETS, 'capture', timeline.video), PUBLIC);
for (const dir of ['audio', 'audio-linkedin']) {
  for (const file of fs.readdirSync(path.join(ASSETS, dir)).filter((f) => f.endsWith('.mp3'))) {
    copyInto(path.join(ASSETS, dir, file), path.join(PUBLIC, dir));
  }
}

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'edit.json'), JSON.stringify(edit, null, 2));

const secs = (f) => (f / FPS).toFixed(1);
console.log(`capture       ${timeline.videoDurationSec}s -> public/${timeline.video}`);
console.log(`wide film     ${secs(wideTotal)}s  (${wideBeats.length} narrated beats)`);
console.log(`linkedin cut  ${secs(cursor)}s  (${liBeats.length} narrated beats)`);
console.log(`highlights    ${marks.length} on the wide film, ${liBeats.reduce((n, b) => n + b.highlights.length, 0)} carried into the cut`);
console.log(`wrote ${path.relative(DEMO, path.join(DATA, 'edit.json'))}`);
