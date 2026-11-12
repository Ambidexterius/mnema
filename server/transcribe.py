"""Local CPU transcription. Model files are baked into the image; no audio leaves it."""
from __future__ import annotations
import argparse
import gc
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('output')
    parser.add_argument('--model', required=True)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--duration', type=float, default=0)
    parser.add_argument('--checkpoint')
    args = parser.parse_args()
    os.umask(0o077)
    os.environ.setdefault('OMP_NUM_THREADS', str(max(1, args.threads)))
    from faster_whisper import WhisperModel
    started = time.monotonic()
    last_progress = 0.0
    def progress(phase, processed=0.0, chunk=0, chunks=0, force=False):
        nonlocal last_progress
        now = time.monotonic()
        if force or now - last_progress >= 5:
            print(json.dumps({'event': 'progress', 'phase': phase,
                              'processedSeconds': round(min(processed, args.duration), 2),
                              'totalSeconds': args.duration, 'chunk': chunk, 'chunks': chunks}), flush=True)
            last_progress = now
    segments = []
    duration = 0
    language = None
    chunks = sorted(Path(args.audio).glob('audio-*.flac'))
    completed = 0
    checkpoint = Path(args.checkpoint) if args.checkpoint else None
    identity = {'schema': 1, 'model': args.model, 'audioSeconds': args.duration,
                'chunks': len(chunks), 'pipeline': 'small-int8-beam1-vad-v1'}
    if checkpoint:
        try:
            saved = json.loads(checkpoint.read_text(encoding='utf-8'))
            if not isinstance(saved, dict):
                raise ValueError('checkpoint must be an object')
            count = saved.get('completedChunks')
            saved_segments = saved.get('segments')
            saved_duration = saved.get('duration')
            if (saved.get('identity') == identity and type(count) is int and 0 <= count <= len(chunks)
                    and isinstance(saved_segments, list) and isinstance(saved_duration, (int, float))
                    and 0 <= saved_duration <= args.duration + 1
                    and all(isinstance(s, dict) and isinstance(s.get('text'), str)
                            and isinstance(s.get('time'), (int, float)) and isinstance(s.get('end'), (int, float))
                            and 0 <= s['time'] <= s['end'] <= saved_duration + 1 for s in saved_segments)):
                completed, segments, duration = count, saved_segments, saved_duration
                language = saved.get('language')
        except (OSError, ValueError, TypeError):
            pass  # Missing/corrupt checkpoints are never treated as finished ASR.
    model = None
    if completed < len(chunks):
        progress('loading', force=True)
        model = WhisperModel(args.model, device='cpu', compute_type='int8',
                             cpu_threads=max(1, args.threads), num_workers=1,
                             local_files_only=True)
    for index, audio in enumerate(chunks[completed:], completed + 1):
        progress('transcribing', duration, index, len(chunks), force=True)
        iterator, info = model.transcribe(str(audio), beam_size=1, best_of=1,
                                         temperature=0, vad_filter=True,
                                         condition_on_previous_text=False,
                                         word_timestamps=False)
        language = language or info.language
        for segment in iterator:
            progress('transcribing', duration + segment.end, index, len(chunks))
            content = segment.text.strip()
            if content:
                segments.append({'time': round(duration + segment.start, 2),
                                 'end': round(duration + segment.end, 2),
                                 'speaker': 'Запись', 'text': content})
        duration += info.duration
        if checkpoint:
            temporary = checkpoint.with_suffix('.part')
            temporary.write_text(json.dumps({'identity': identity, 'completedChunks': index,
                                             'segments': segments, 'duration': duration, 'language': language},
                                            ensure_ascii=False), encoding='utf-8')
            temporary.replace(checkpoint)
        progress('transcribing', duration, index, len(chunks), force=True)
    # The two model families must not occupy the small server's RAM together.
    iterator = None
    del model
    gc.collect()
    speakers, diarization_error = 0, None
    output = Path(args.output)
    def save_result():
        result = {'segments': segments, 'duration': round(duration, 2),
                  'language': language, 'model': 'Whisper Small int8',
                  'processingSeconds': round(time.monotonic() - started, 2),
                  'diarization': speakers > 0, 'speakers': speakers,
                  'transcriptionComplete': True}
        if diarization_error:
            result['diarizationError'] = diarization_error
        temporary = output.with_suffix('.part')
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        temporary.replace(output)
        return result
    # Only a complete speech pass is checkpointed. Optional speaker detection
    # must not destroy a finished transcript if its process is killed later.
    diarization_error = 'NotCompleted'
    save_result()
    diarization_error = None
    models = os.environ.get('ASR_DIARIZATION_DIR', '/app/models/diarization')
    if segments and os.environ.get('ASR_DIARIZATION', '1') != '0':
        try:
            from diarize import models_ready, diarize_chunks, label_segments
            if models_ready(models):
                progress('diarization', 0, 1, len(chunks), force=True)
                turns, _ = diarize_chunks(chunks, models,
                                          max(1, args.threads),
                                          float(os.environ.get('ASR_DIARIZATION_THRESHOLD', '0.7')),
                                          on_progress=lambda done, index, total: progress('diarization', done, index, total, force=True))
                segments, speakers = label_segments(segments, turns)
        except Exception as error:  # Speakers are optional: keep the transcript.
            diarization_error = type(error).__name__
    result = save_result()
    # Log measurements only; transcript is written to the private output file.
    print(json.dumps({'segments': len(segments), 'duration': result['duration'],
                      'processingSeconds': result['processingSeconds']}))


if __name__ == '__main__':
    main()
