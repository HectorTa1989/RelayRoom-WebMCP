/**
 * Brings the rendered films up to social/broadcast loudness.
 *
 * Remotion mixes the narration at its natural level, which lands around
 * -25 LUFS - noticeably quieter than the rest of a LinkedIn or YouTube feed.
 * This runs a two-pass EBU R128 normalisation to -16 LUFS with -1.5 dBTP of
 * headroom, copying the video stream through untouched, so it costs seconds and
 * cannot degrade the picture.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(path.resolve(HERE, '..'), 'video');

const I = -16;
const TP = -1.5;
const LRA = 11;

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' });
  if (run.error) throw run.error;
  // loudnorm reports on stderr, on success as well as failure.
  return `${run.stdout ?? ''}${run.stderr ?? ''}`;
}

function measure(file) {
  const out = ffmpeg(['-i', file, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-']);
  const open = out.lastIndexOf('{');
  const close = out.lastIndexOf('}');
  if (open === -1 || close === -1) throw new Error(`could not read loudnorm analysis for ${path.basename(file)}`);
  return JSON.parse(out.slice(open, close + 1));
}

function normalize(file) {
  const stats = measure(file);
  const tmp = file.replace(/\.mp4$/, '.norm.mp4');
  const filter = [
    `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`,
    `measured_I=${stats.input_i}`,
    `measured_TP=${stats.input_tp}`,
    `measured_LRA=${stats.input_lra}`,
    `measured_thresh=${stats.input_thresh}`,
    `offset=${stats.target_offset}`,
    'linear=true',
  ].join(':');

  // loudnorm resamples internally; pin the output back to 48 kHz stereo AAC,
  // which is what every platform expects.
  ffmpeg(['-i', file, '-c:v', 'copy', '-af', filter, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', tmp]);
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) throw new Error(`normalisation produced no output for ${path.basename(file)}`);
  fs.rmSync(file);
  fs.renameSync(tmp, file);
  return stats;
}

for (const name of ['relayroom-demo.mp4', 'relayroom-linkedin.mp4']) {
  const file = path.join(VIDEO, name);
  if (!fs.existsSync(file)) {
    console.warn(`skip ${name} (not rendered yet)`);
    continue;
  }
  const before = normalize(file);
  const after = measure(file);
  console.log(
    `${name.padEnd(26)} ${Number(before.input_i).toFixed(1)} -> ${Number(after.input_i).toFixed(1)} LUFS` +
    `   peak ${Number(before.input_tp).toFixed(1)} -> ${Number(after.input_tp).toFixed(1)} dBTP`,
  );
}
