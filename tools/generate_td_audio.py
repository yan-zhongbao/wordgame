import math
import os
import random
import wave


SAMPLE_RATE = 44100


def clamp(value, limit=1.0):
    return max(-limit, min(limit, value))


def envelope(t, attack=0.02, decay=6.0):
    if t < attack:
        return t / attack
    return math.exp(-decay * (t - attack))


def render_tone(freqs, duration, volume=0.5, decay=6.0):
    total = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(total):
        t = i / SAMPLE_RATE
        env = envelope(t, decay=decay)
        value = 0.0
        for freq, amp in freqs:
            value += amp * math.sin(2 * math.pi * freq * t)
        value *= volume * env
        samples.append(clamp(value))
    return samples


def render_noise(duration, volume=0.4, decay=4.0):
    total = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(total):
        t = i / SAMPLE_RATE
        env = envelope(t, decay=decay)
        value = (random.random() * 2 - 1) * volume * env
        samples.append(clamp(value))
    return samples


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for sample in samples:
            frames.extend(int(sample * 32767).to_bytes(2, "little", signed=True))
        wav_file.writeframes(frames)


def generate_sfx(output_dir):
    sounds = {
        "shot.wav": render_tone([(880, 0.7), (1320, 0.35)], 0.18, volume=0.6, decay=5.0),
        "error.wav": render_tone([(180, 0.9), (120, 0.4)], 0.25, volume=0.7, decay=3.5),
        "hit1.wav": render_tone([(520, 0.8)], 0.12, volume=0.5, decay=7.0),
        "hit2.wav": render_tone([(620, 0.8)], 0.12, volume=0.55, decay=7.0),
        "hit3.wav": render_tone([(740, 0.8)], 0.12, volume=0.6, decay=7.0),
        "explode.wav": render_noise(0.35, volume=0.5, decay=3.0),
    }
    for name, samples in sounds.items():
        write_wav(os.path.join(output_dir, name), samples)


if __name__ == "__main__":
    target = os.path.join(os.path.dirname(__file__), "..", "audio", "td")
    generate_sfx(os.path.abspath(target))
    print(f"TD SFX generated in {os.path.abspath(target)}")
