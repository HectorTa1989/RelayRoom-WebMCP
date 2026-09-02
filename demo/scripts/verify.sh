#!/usr/bin/env bash
# Sanity-checks the rendered deliverables: dimensions, duration, and that an
# audio track actually made it into the file.
set -u
cd "$(dirname "$0")/.."
fail=0
for f in video/relayroom-demo.mp4 video/relayroom-linkedin.mp4; do
  if [ ! -f "$f" ]; then echo "MISSING $f"; fail=1; continue; fi
  v=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 "$f")
  a=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels,sample_rate -of csv=p=0 "$f")
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  s=$(du -h "$f" | cut -f1)
  printf '%-34s %-22s %-22s %6.1fs %6s\n' "$f" "$v" "${a:-NO AUDIO}" "$d" "$s"
  [ -z "$a" ] && { echo "  ^ no audio stream"; fail=1; }
done
exit $fail
