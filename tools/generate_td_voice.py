import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_MODEL = "gpt-4o-mini-tts"
DEFAULT_VOICE = "alloy"

LINES = {
    "voice_fail.wav": "你该去做作业了。",
    "voice_bag_1.wav": "快把作业做完！",
    "voice_bag_2.wav": "这个作业你还没写！",
    "voice_bag_3.wav": "作业堆起来啦！",
}


def resolve_base_url():
    return os.environ.get("OPENAI_BASE_URL") or os.environ.get("OPENAI_API_BASE") or "https://api.openai.com/v1"


def fetch_tts(api_key, base_url, model, voice, text, response_format, speed):
    payload = {
        "model": model,
        "voice": voice,
        "input": text,
    }
    if response_format:
        payload["response_format"] = response_format
    if speed is not None:
        payload["speed"] = speed
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/audio/speech",
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def main():
    parser = argparse.ArgumentParser(description="Generate TD voice files with OpenAI TTS.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="TTS model name.")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="Voice name.")
    parser.add_argument("--format", default="wav", help="Audio format, e.g. wav or mp3.")
    parser.add_argument("--speed", type=float, default=None, help="Speaking speed, e.g. 1.0.")
    parser.add_argument("--output", default=None, help="Output directory for audio files.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing files.")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY is not set.", file=sys.stderr)
        return 1

    base_url = resolve_base_url()
    output_dir = Path(args.output) if args.output else Path(__file__).resolve().parent.parent / "audio" / "td"
    output_dir.mkdir(parents=True, exist_ok=True)

    for filename, text in LINES.items():
        out_path = output_dir / filename
        if out_path.exists() and not args.overwrite:
            print(f"skip: {out_path}")
            continue
        try:
            audio_data = fetch_tts(
                api_key=api_key,
                base_url=base_url,
                model=args.model,
                voice=args.voice,
                text=text,
                response_format=args.format,
                speed=args.speed,
            )
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="ignore")
            print(f"error: {filename}: {err.code} {err.reason} {detail}", file=sys.stderr)
            return 1
        except Exception as err:
            print(f"error: {filename}: {err}", file=sys.stderr)
            return 1
        out_path.write_bytes(audio_data)
        print(f"ok: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
