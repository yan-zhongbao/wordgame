import argparse
import asyncio
import json
import re
from pathlib import Path


def slugify(text: str) -> str:
    slug = text.lower().strip()
    slug = slug.replace("'", "").replace("’", "")
    slug = re.sub(r"\s+", "_", slug)
    slug = re.sub(r"[^a-z0-9_-]", "_", slug)
    slug = re.sub(r"_+", "_", slug)
    slug = slug.strip("_")
    return slug


def normalize_tts_text(text: str) -> str:
    cleaned = text.strip()
    cleaned = cleaned.replace("/", " or ")
    cleaned = re.sub(r"\.{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


async def synthesize(item, voice, force, out_root):
    en = item.get("en", "").strip()
    kind = item.get("kind", "word")
    if not en:
        return False
    slug = slugify(en)
    if not slug:
        return False
    folder = "phrase" if kind == "phrase" else "en"
    out_path = out_root / folder / f"{slug}.mp3"
    if out_path.exists() and not force:
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    text = normalize_tts_text(en)
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(str(out_path))
    return True


async def run(words_path, voice, force, limit, out_root):
    data = json.loads(words_path.read_text(encoding="utf-8"))
    items = data[:limit] if limit else data
    generated = 0
    for index, item in enumerate(items, start=1):
        try:
            created = await synthesize(item, voice, force, out_root)
            if created:
                generated += 1
                print(f"[{index}/{len(items)}] OK  {item['en']}")
            else:
                print(f"[{index}/{len(items)}] SKIP {item['en']}")
        except Exception as exc:
            print(f"[{index}/{len(items)}] FAIL {item.get('en', '')} -> {exc}")
        await asyncio.sleep(0.05)
    print(f"Generated {generated} audio files.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="en-US-AriaNeural")
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    parser.add_argument("--limit", type=int, default=0, help="only generate first N entries")
    parser.add_argument("--words", default="words.json")
    parser.add_argument("--out", default="audio")
    args = parser.parse_args()

    words_path = Path(args.words)
    if not words_path.exists():
        raise SystemExit(f"Missing words file: {words_path}")
    out_root = Path(args.out)

    asyncio.run(run(words_path, args.voice, args.force, args.limit, out_root))


if __name__ == "__main__":
    try:
        import edge_tts
    except ImportError:
        raise SystemExit(
            "Missing edge-tts. Install with: python -m pip install edge-tts"
        )
    main()
