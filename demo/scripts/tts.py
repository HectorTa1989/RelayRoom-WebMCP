"""Render the RelayRoom narration with a natural neural voice (edge-tts).

Writes one mp3 per beat into demo/assets/audio and a manifest with measured
durations. The capture script paces the browser to those durations so the
voiceover and the on-screen action stay locked together.
"""
import asyncio
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / (sys.argv[1] if len(sys.argv) > 1 else "narration.json")
OUT = ROOT / "assets" / ("audio-linkedin" if "linkedin" in SCRIPT.name else "audio")


def probe_duration(path: pathlib.Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return round(float(out.stdout.strip()), 3)


async def main() -> None:
    import edge_tts

    spec = json.loads(SCRIPT.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []

    for beat in spec["beats"]:
        target = OUT / f"{beat['id']}.mp3"
        communicate = edge_tts.Communicate(
            beat["text"], spec["voice"], rate=spec["rate"], pitch=spec["pitch"]
        )
        await communicate.save(str(target))
        duration = probe_duration(target)
        manifest.append({
            "id": beat["id"],
            "chapter": beat.get("chapter"),
            "caption": beat["caption"],
            "text": beat["text"],
            "anchor": beat.get("anchor"),
            "focus": beat.get("focus"),
            "file": f"{OUT.name}/{target.name}",
            "duration": duration,
        })
        safe = beat["caption"].encode("ascii", "replace").decode("ascii")
        print(f"  {beat['id']:<14} {duration:6.2f}s  {safe}")

    total = sum(item["duration"] for item in manifest)
    (OUT / "manifest.json").write_text(
        json.dumps({"voice": spec["voice"], "beats": manifest, "speechSeconds": round(total, 3)}, indent=2),
        encoding="utf-8",
    )
    print(f"\nSpeech total: {total:.1f}s across {len(manifest)} beats")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # noqa: BLE001
        print(f"TTS failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
