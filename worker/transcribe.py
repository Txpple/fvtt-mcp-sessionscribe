#!/usr/bin/env python
"""transcribe.py: the scribe's one Python step, per-track faster-whisper with VAD.

Run as a detached job by fvtt-mcp-sessionscribe's transcribe-recording tool (src/jobs.ts), with
the transcription venv's interpreter (scripts/setup.ps1 builds it):

  transcribe --session-dir D [--model M] [--device auto|cuda|cpu] [--language en]
             [--hotwords "Names, said, at the table."] [--fresh]
  smoke [clip]                verify faster-whisper loads on CUDA (setup.ps1 runs this)

Ported from session_scribe.py (fvtt-mcp-dnd5e), which also fetched and aligned; those are
TypeScript now. What changed here: each track's segments are written the moment the track
finishes (audio/.jobs/transcribe.tracks/), so a crash or a killed run resumes where it stopped
instead of losing the lot, and the job status file (SCRIBE_JOB_STATUS, the src/jobs.ts contract)
says which track is running. transcript-segments.json is assembled at the end, in the shape
build-transcript reads: {model, hotwords, device, tracks: [{file, speaker, segments: [{start, end, text}]}]}.
"""

import argparse
import datetime as dt
import json
import os
import re
import site
import sys
import time
from pathlib import Path

AUDIO_EXTS = {".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".mp3"}
STARTED_AT = dt.datetime.now(dt.timezone.utc)


def iso(t: dt.datetime) -> str:
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_json(path: Path, data, indent=2) -> None:
    """Atomic: a reader never sees half a file."""
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=indent), encoding="utf-8")
    os.replace(tmp, path)


def status(state: str, step: str, progress: str | None = None, **extra) -> None:
    """The job status file, when run as a job (a bare CLI run has none)."""
    target = os.environ.get("SCRIBE_JOB_STATUS")
    if not target:
        return
    body = {"kind": "transcribe", "state": state, "step": step, "pid": os.getpid(),
            "startedAt": iso(STARTED_AT), "updatedAt": iso(dt.datetime.now(dt.timezone.utc))}
    if progress:
        body["progress"] = progress
    body.update(extra)
    write_json(Path(target), body)


def log(line: str) -> None:
    print(f"[{iso(dt.datetime.now(dt.timezone.utc))}] {line}", flush=True)


# --- CUDA DLL bootstrap -------------------------------------------------------

def add_nvidia_dlls() -> list[str]:
    """Register pip-installed NVIDIA DLL dirs. ctranslate2 resolves cuBLAS by bare LoadLibrary
    name, which ignores add_dll_directory, so the dirs must also be on PATH."""
    added = []
    for sp in site.getsitepackages():
        nvidia = Path(sp) / "nvidia"
        if not nvidia.is_dir():
            continue
        for bin_dir in nvidia.glob("*/bin"):
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(bin_dir))
            added.append(str(bin_dir))
    os.environ["PATH"] = os.pathsep.join(added + [os.environ.get("PATH", "")])
    return added


def load_model(model_name: str, device: str):
    from faster_whisper import WhisperModel

    if device in ("auto", "cuda"):
        try:
            return WhisperModel(model_name, device="cuda", compute_type="float16"), "cuda/float16"
        except Exception as e:
            if device == "cuda":
                raise
            log(f"CUDA unavailable ({e!r}); falling back to CPU int8 (slower)")
    return WhisperModel(model_name, device="cpu", compute_type="int8"), "cpu/int8"


# --- transcription ------------------------------------------------------------

GAP_SECONDS = 1.5  # a pause between two words this long starts a new segment
FUNCTION_WORDS = {"the", "and", "of", "a", "an"}


def split_on_gaps(segment) -> list[dict]:
    """VAD joins the speech chunks before whisper sees them, so one segment can hold lines said
    minutes apart (a 1,248 s segment on a quiet player's track). Its words are restored to the
    track's clock one by one, so cut the segment wherever the speaker went quiet."""
    words = [w for w in (segment.words or []) if w.word.strip()]
    if not words:
        return [{"start": round(segment.start, 2), "end": round(segment.end, 2), "text": segment.text.strip()}]
    runs, run = [], [words[0]]
    for w in words[1:]:
        if w.start - run[-1].end >= GAP_SECONDS:
            runs.append(run)
            run = [w]
        else:
            run.append(w)
    runs.append(run)
    return [{"start": round(r[0].start, 2), "end": round(r[-1].end, 2),
             "text": "".join(w.word for w in r).strip()} for r in runs]


def echoes_prompt(text: str, prompt_words: set[str]) -> bool:
    """Over noise whisper sometimes reads the hotwords back ("Aldric Stone, Brenna Quickfoot, Phandalin ...").
    A line of six words or more that is mostly the prompt's names is that, not speech."""
    words = re.findall(r"[a-z']+", text.lower())
    return len(words) >= 6 and sum(w in prompt_words for w in words) / len(words) >= 0.7

def track_speaker(path: Path, users: list[dict]) -> str:
    """`N-name.flac` → craig-info.json's label for track N, else the file's own name part."""
    m = re.match(r"^(\d+)[-_](.+)$", path.stem)
    if m:
        idx = int(m.group(1))
        for u in users:
            if u.get("track") == idx and u.get("name"):
                return u["name"]
        return m.group(2)
    return path.stem


def cmd_transcribe(args) -> int:
    sdir = Path(args.session_dir)
    tracks_dir = sdir / "audio" / "tracks"
    files = sorted(p for p in tracks_dir.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    if not files:
        raise SystemExit(f"No audio tracks under {tracks_dir}: run fetch-recording first.")

    meta = {}
    info_path = sdir / "craig-info.json"
    if info_path.exists():
        meta = json.loads(info_path.read_text(encoding="utf-8"))
    users = meta.get("users", [])

    partial = sdir / "audio" / ".jobs" / "transcribe.tracks"
    partial.mkdir(parents=True, exist_ok=True)
    if args.fresh:
        for f in partial.glob("*.json"):
            f.unlink()

    status("running", "loading", f"model {args.model}")
    add_nvidia_dlls()
    log(f"Loading model {args.model} ...")
    model, device = load_model(args.model, args.device)
    log(f"Model on {device}; {len(files)} tracks")
    hotwords = args.hotwords.strip() or None
    if hotwords:
        n = len(model.hf_tokenizer.encode(" " + hotwords).ids)
        cap = model.max_length // 2 - 1
        log(f"Vocabulary prompt: {n} tokens" + (f"; whisper keeps the first {cap}" if n > cap else ""))
    prompt_words = set(re.findall(r"[a-z']+", (hotwords or "").lower())) - FUNCTION_WORDS
    # A finished track is reused only when it was transcribed the same way.
    settings = {"model": args.model, "hotwords": hotwords}

    out_tracks = []
    total_segments = 0
    t_all = time.time()
    for i, path in enumerate(files, 1):
        speaker = track_speaker(path, users)
        done_file = partial / f"{path.stem}.json"
        if done_file.exists():
            track = json.loads(done_file.read_text(encoding="utf-8"))
            if track.get("model") == args.model and track.get("hotwords") == hotwords:
                log(f"  {path.name} [{speaker}]: resumed ({len(track['segments'])} segments)")
                out_tracks.append({"file": path.name, "speaker": speaker, "segments": track["segments"]})
                total_segments += len(track["segments"])
                continue
        where = f"track {i}/{len(files)}: {path.name} ({speaker})"
        status("running", "transcribing", where)
        t0 = time.time()
        # condition_on_previous_text=False: conditioned on its own output, whisper that once drops
        # into lowercase without punctuation stays there for the rest of a three-hour track, and a
        # repeated line loops ("i'm good" ×30). hotwords is prefixed to every window, so the names
        # and a punctuated style ride along where the previous text no longer does.
        segments, seg_info = model.transcribe(str(path), vad_filter=True, language=args.language or None,
                                              condition_on_previous_text=False, hotwords=hotwords,
                                              word_timestamps=True)
        # segments is lazy: the work happens in this loop, so it is where progress is known. The DM's
        # three-hour track takes minutes even on a 5090; without this the status sat still that long.
        segs = []
        echoes = 0
        reported = t0
        for s in segments:
            for part in split_on_gaps(s):
                if not part["text"]:
                    continue
                if prompt_words and echoes_prompt(part["text"], prompt_words):
                    echoes += 1
                    continue
                segs.append(part)
            if time.time() - reported >= 15:
                reported = time.time()
                status("running", "transcribing",
                       f"{where} {100 * s.end / max(seg_info.duration, 1):.0f}%")
        write_json(done_file, {**settings, "device": device, "segments": segs}, indent=1)
        log(f"  {path.name} [{speaker}]: {len(segs)} segments, "
            f"{seg_info.duration:.0f}s audio in {time.time() - t0:.0f}s"
            + (f"; {echoes} prompt echoes dropped" if echoes else ""))
        out_tracks.append({"file": path.name, "speaker": speaker, "segments": segs})
        total_segments += len(segs)

    target = sdir / "transcript-segments.json"
    write_json(target, {**settings, "device": device, "tracks": out_tracks}, indent=1)
    log(f"Wrote {target}")
    status("done", "done", result={"file": str(target), "tracks": len(out_tracks),
                                   "segments": total_segments, "model": args.model,
                                   "device": device, "seconds": round(time.time() - t_all)})
    return 0


def cmd_smoke(args) -> int:
    dirs = add_nvidia_dlls()
    print(f"NVIDIA DLL dirs: {len(dirs)}")
    model, device = load_model("tiny", "auto")
    print(f"Model loaded on: {device}")
    if args.audio:
        segments, info = model.transcribe(args.audio, vad_filter=True)
        print(f"Audio: {info.duration:.1f}s, language={info.language}")
        for seg in segments:
            print(f"  [{seg.start:6.2f} -> {seg.end:6.2f}] {seg.text}")
    print("SMOKE TEST OK" if device.startswith("cuda") else "SMOKE TEST OK (CPU ONLY)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="transcribe")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("smoke", help="verify the CUDA transcription stack")
    p.add_argument("audio", nargs="?", help="optional test clip to transcribe")
    p.set_defaults(fn=cmd_smoke)

    p = sub.add_parser("transcribe", help="transcribe every track with faster-whisper")
    p.add_argument("--session-dir", required=True)
    p.add_argument("--model", default="large-v3")
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--language", default="en", help="empty string = autodetect")
    p.add_argument("--hotwords", default="", help="the campaign's names, prefixed to every window")
    p.add_argument("--fresh", action="store_true", help="ignore tracks finished by an earlier run")
    p.set_defaults(fn=cmd_transcribe)

    args = ap.parse_args()
    try:
        return args.fn(args)
    except BaseException as e:  # noqa: BLE001 — every ending must reach the status file
        if isinstance(e, SystemExit) and e.code in (0, None):
            raise
        message = str(e) if not isinstance(e, KeyboardInterrupt) else "interrupted"
        log(f"failed: {message}")
        status("failed", "failed", error=message)
        return 1


if __name__ == "__main__":
    sys.exit(main())
