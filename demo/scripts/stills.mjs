/**
 * Pulls the post images out of the finished films.
 *
 * Timestamps are derived from the edit plan rather than hard-coded, so a
 * re-capture that shifts the pacing still produces the right frames.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');
const edit = JSON.parse(fs.readFileSync(path.join(DEMO, 'remotion', 'src', 'data', 'edit.json'), 'utf8'));

const FPS = edit.fps;
const OUT = path.join(DEMO, 'assets', 'stills');
const WIDE = path.join(DEMO, 'video', 'relayroom-demo.mp4');
const CUT = path.join(DEMO, 'video', 'relayroom-linkedin.mp4');

const beat = (id) => {
  const b = edit.wide.beats.find((x) => x.id === id);
  if (!b) throw new Error(`no beat ${id}`);
  return b;
};
const highlight = (fragment) => {
  const h = edit.wide.highlights.find((x) => (x.label ?? '').includes(fragment));
  if (!h) throw new Error(`no highlight matching "${fragment}"`);
  return h;
};
const at = (frame) => (frame / FPS).toFixed(2);

// Seconds into each film, expressed against the plan.
const shots = [
  [WIDE, at(edit.wide.introFrames / 2), 'title-card.png'],
  [WIDE, at(beat('b03_tools').audioFrom + beat('b03_tools').audioDuration * 0.55), 'tool-popover.png'],
  [WIDE, at(beat('b04_portals').audioFrom + 3 * FPS), 'partner-portals.png'],
  [WIDE, at(beat('b07_route').audioFrom + 2 * FPS), 'coordinated-plan.png'],
  [WIDE, at(beat('b08_sequence').audioFrom + 3 * FPS), 'ordered-transaction.png'],
  [WIDE, at(highlight('3 partner origins').from + 20), 'evidence-arrived.png'],
  [WIDE, at(highlight('Commit tools unlocked').from + 22), 'approval-commit.png'],
  [WIDE, at(beat('b10_audit').audioFrom + 4 * FPS), 'audit-receipt.png'],
  [WIDE, at(highlight('Supplier hold released').from + 22), 'rollback-receipt.png'],
  [WIDE, at(edit.wide.totalFrames - edit.wide.outroFrames / 2), 'closing-card.png'],
  [CUT, '1.20', 'linkedin-title.png'],
  [CUT, at(edit.linkedin.beats[1].from + 3 * FPS), 'linkedin-frame.png'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [src, seconds, name] of shots) {
  if (!fs.existsSync(src)) {
    console.warn(`skip ${name} (${path.basename(src)} not rendered)`);
    continue;
  }
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(seconds), '-i', src, '-vframes', '1', path.join(OUT, name)]);
  console.log(`  ${name.padEnd(26)} ${String(seconds).padStart(7)}s  ${path.basename(src)}`);
}
