# RelayRoom demo kit

Everything needed to publish the RelayRoom demo: the narrated film, the LinkedIn cut, and the
two written posts.

## Deliverables

| File | What it is |
|---|---|
| `medium-post.md` | Long-form engineering write-up, ready to paste into Medium |
| `linkedin-post.md` | LinkedIn post copy (primary + short variant) and posting notes |
| `video/relayroom-demo.mp4` | Narrated walkthrough, 1920×1080 @ 30fps, 2:59 |
| `video/relayroom-linkedin.mp4` | Feed cut, 1080×1350 (4:5) @ 30fps, 0:41 |
| `assets/stills/` | Frames pulled from the finished films for thumbnails and post images |

The Medium post already references eight of the stills as inline figures. They are frames from the
rendered film, so what ships in the article is exactly what ships in the video. Regenerate them
with `node demo/scripts/stills.mjs` after any re-render.

## How the video is made

The film is not a hand-recorded screencast. It is regenerated from the running app by a
four-stage pipeline, so a UI change means re-running one command rather than re-recording.

```
narration.json ──▶ tts.py ──▶ audio/*.mp3 + manifest.json (measured durations)
                                        │
                                        ▼
                             capture.mjs (Playwright)
                    drives the live 5-origin stack, paced to the
                    narration, logs the true start of every beat
                                        │
                                        ▼
                   relayroom-capture.mp4 + timeline.json
                                        │
                                        ▼
                    sync-remotion.mjs ──▶ remotion/src/data/edit.json
                                        │
                                        ▼
                              Remotion ──▶ video/*.mp4
```

Because every beat offset is *measured* rather than assumed, the voiceover and the picture
cannot drift, no matter how long the recorded take turns out to be.

### 1. Narration

`scripts/narration.json` (wide film) and `scripts/narration-linkedin.json` (feed cut) hold the
script: one beat per line, with the chapter title and the on-screen caption. `scripts/tts.py`
renders each line with the `en-US-AndrewMultilingualNeural` neural voice via `edge-tts`, then
measures the result with `ffprobe` and writes `assets/audio*/manifest.json`.

```bash
python demo/scripts/tts.py narration.json
python demo/scripts/tts.py narration-linkedin.json
```

### 2. Capture

`scripts/capture.mjs` drives the real app — the room, three partner portals and four APIs —
through the whole product story with Playwright, holding each beat for at least the length of
its narration line and recording the true offsets into `assets/capture/timeline.json`.

`scripts/cursor.js` is injected before any page script and draws the pointer you see in the
video: an eased arc between targets plus a click ripple. Real `page.mouse` events fire
underneath it, so hover states are genuine and the pointer stays visible over the partner
iframes.

**Status highlights.** When a click changes something in the app, the script calls `mark()`,
which records the *real* bounding box of the thing that changed at the *real* moment it
changed. Those rectangles become the coloured rings and labels in the film — green for a
completed change, amber for an armed or restricted state, red for a failure. Because the
rectangles come from the live DOM rather than from hand-measured coordinates, they cannot drift
out of register when the layout changes. Only call `mark()` where the page will hold still for
the duration of the hold; a scroll mid-hold would strand the ring.

**The app must already be running** (`npm run dev` from the repo root):

```bash
node demo/scripts/capture.mjs
```

Three things this script gets right that are easy to get wrong:

- It passes `--force-device-scale-factor=1.25` as a *browser* argument. The context-level
  `deviceScaleFactor` does not reliably reach the screencast encoder, and without it the
  recording lands at 1536×864 inside a 1920×1080 canvas. A 1536×864 viewport at scale 1.25 is
  exactly 1920×1080 device pixels — native 1080p, with the app laid out large enough to read
  on a phone.
- The cursor glide is bounded by wall clock, not by a step count. Tying it to CDP round trips
  makes a heavier render silently double the length of the take.
- The transcode forces a keyframe every second and no B-frames
  (`-g 30 -keyint_min 30 -sc_threshold 0 -bf 0`). Remotion seeks to arbitrary frames; with
  libx264's default 250-frame GOP the render dies partway through on
  `No frame found at position`, even though single stills at the same timestamps render fine.

### 3. Assemble

```bash
node demo/scripts/sync-remotion.mjs      # copies assets, derives the edit plan
cd demo/remotion
npm install
npm run render                            # wide film
npm run render:linkedin                   # feed cut
npm run studio                            # interactive preview
cd ../..
node demo/scripts/normalize-audio.mjs     # -21 LUFS mix -> -16 LUFS for social
```

Remotion mixes the narration at its natural level, around -21 LUFS, which reads as quiet next
to everything else in a feed. `normalize-audio.mjs` runs a two-pass EBU R128 normalisation to
-16 LUFS with -1.5 dBTP of headroom and copies the video stream through untouched.

`sync-remotion.mjs` is the only place timing lives. It maps each captured beat's wall-clock
offset onto source-video seconds (Playwright's screencast clock runs a hair slower than wall
clock, so the measured ratio is applied), places each voiceover clip and each status highlight
at the matching frame, and writes `remotion/src/data/edit.json`. Both compositions read that
one file.

The LinkedIn clips do not name timestamps. Each one anchors to a beat or to a named status mark
with an offset — `{ "mark": "Carrier commit failed", "offset": -1.3 }` — so a re-capture that
shifts the pacing re-cuts the feed version correctly instead of silently drifting off its
subject.

## Regenerating everything

```bash
npm run dev                                    # repo root, in another terminal
python demo/scripts/tts.py narration.json
python demo/scripts/tts.py narration-linkedin.json
node   demo/scripts/capture.mjs
node   demo/scripts/sync-remotion.mjs
cd demo/remotion && npm run render && npm run render:linkedin && cd ../..
node   demo/scripts/normalize-audio.mjs
node   demo/scripts/stills.mjs                 # post images, timed off the edit plan
bash   demo/scripts/verify.sh                  # dimensions, duration, audio track
```

Requirements: Node 22.5+, Python 3.9+ with `edge-tts`, and `ffmpeg`/`ffprobe` on `PATH`.

## Note on the planner badge

The recorded take shows the plan sourced from the **Deterministic** solver, because neither
provider key in `.env` returned a usable response at capture time. That is the honest fallback
path the app is designed for, and the narration covers it explicitly. To capture a take that
shows the **OpenAI** or **Gemini** badge instead, set a working `OPENAI_API_KEY` or
`GEMINI_API_KEY`, restart `npm run dev`, and re-run the capture and assemble steps.
