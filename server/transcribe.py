"""Local CPU transcription. Model files are baked into the image; no audio leaves it."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('output')
    parser.add_argument('--model', required=True)
    parser.add_argument('--threads', type=int, default=1)
    args = parser.parse_args()
    os.umask(0o077)
    os.environ.setdefault('OMP_NUM_THREADS', str(max(1, args.threads)))
    from faster_whisper import WhisperModel
    started = time.monotonic()
    model = WhisperModel(args.model, device='cpu', compute_type='int8',
                         cpu_threads=max(1, args.threads), num_workers=1,
                         local_files_only=True)
    segments = []
    duration = 0
    language = None
    for audio in sorted(Path(args.audio).glob('audio-*.flac')):
        iterator, info = model.transcribe(str(audio), beam_size=1, best_of=1,
                                         temperature=0, vad_filter=True,
                                         condition_on_previous_text=False,
                                         word_timestamps=False)
        language = language or info.language
        for segment in iterator:
            content = segment.text.strip()
            if content:
                segments.append({'time': round(duration + segment.start, 2),
                                 'end': round(duration + segment.end, 2),
                                 'speaker': 'Запись', 'text': content})
        duration += info.duration
    result = {'segments': segments, 'duration': round(duration, 2),
              'language': language, 'model': 'Whisper Small int8',
              'processingSeconds': round(time.monotonic() - started, 2),
              'diarization': False}
    output = Path(args.output)
    temporary = output.with_suffix('.part')
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    temporary.replace(output)
    # Log measurements only; transcript is written to the private output file.
    print(json.dumps({'segments': len(segments), 'duration': result['duration'],
                      'processingSeconds': result['processingSeconds']}))


if __name__ == '__main__':
    main()
