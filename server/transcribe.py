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
    parser.add_argument('--word-times', action='store_true')
    parser.add_argument('--max-speakers', type=int, default=0)
    args = parser.parse_args()
    os.umask(0o077)
    os.environ.setdefault('OMP_NUM_THREADS', str(max(1, args.threads)))
    gigaam = (Path(args.model) / 'encoder.int8.onnx').is_file()
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
                'chunks': len(chunks), 'pipeline': 'gigaam-v3-rnnt-silero-v2' if gigaam else 'small-int8-beam1-vad-v1'}
    if args.word_times:
        identity['wordTimes'] = True
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
        if gigaam:
            model = GigaAM(args.model, max(1, args.threads))
        else:
            from faster_whisper import WhisperModel
            model = WhisperModel(args.model, device='cpu', compute_type='int8',
                                 cpu_threads=max(1, args.threads), num_workers=1,
                                 local_files_only=True)
    for index, audio in enumerate(chunks[completed:], completed + 1):
        progress('transcribing', duration, index, len(chunks), force=True)
        if gigaam:
            # A phrase cut by the 15-minute split is finished from the next part,
            # and that part then starts where the phrase ended.
            following = str(chunks[index]) if index < len(chunks) else None
            skip = max(0.0, segments[-1]['end'] - duration) if segments else 0.0
            iterator, info = model.transcribe(str(audio), following=following, skip=skip)
        else:
            iterator, info = model.transcribe(str(audio), beam_size=1, best_of=1,
                                             temperature=0, vad_filter=True,
                                             condition_on_previous_text=False,
                                             word_timestamps=args.word_times)
        language = language or info.language
        for segment in iterator:
            progress('transcribing', duration + segment.end, index, len(chunks))
            content = segment.text.strip()
            if content:
                item = {'time': round(duration + segment.start, 2),
                        'end': round(duration + segment.end, 2),
                        'speaker': 'Запись', 'text': content}
                words = getattr(segment, 'words', None)
                if words:  # [time, text, unsure]: lets speakers split a segment mid-way
                    item['words'] = [[round(duration + t, 2), w, u] for t, w, u in words]
                    unsure = any(u for _, _, u in words)
                else:
                    unsure = segment.avg_logprob < -1 or segment.no_speech_prob > 0.6
                    if args.word_times and segment.words:
                        item['wordTimes'] = word_times(content, [(duration + w.start, w.word, duration + w.end)
                                                                 for w in segment.words])
                        if item['wordTimes'] is None:
                            del item['wordTimes']
                if unsure:
                    item['uncertain'] = True
                segments.append(item)
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
    def finished(segment):
        item = {k: v for k, v in segment.items() if k != 'words'}
        words = segment.get('words')
        # Express word times as character ranges of the final text, so they are
        # built after speakers may have cut the segment.
        if args.word_times and words:
            ends = [at for at, _, _ in words[1:]] + [segment['end']]
            times = word_times(segment['text'], [(at, word, end) for (at, word, _), end in zip(words, ends)])
            if times is not None:
                item['wordTimes'] = times
        return item
    def save_result():
        result = {'segments': [finished(s) for s in segments],
                  'duration': round(duration, 2),
                  'language': language, 'model': 'GigaAM v3 int8' if gigaam else 'Whisper Small int8',
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
                print('{"event":"transcript-ready"}', flush=True)
                progress('diarization', 0, 1, len(chunks), force=True)
                turns, _ = diarize_chunks(chunks, models,
                                          max(1, args.threads),
                                          float(os.environ.get('ASR_DIARIZATION_THRESHOLD', '0.7')),
                                          max_speakers=args.max_speakers,
                                          on_progress=lambda done, index, total: progress('diarization', done, index, total, force=True))
                segments, speakers = label_segments(segments, turns)
        except Exception as error:  # Speakers are optional: keep the transcript.
            diarization_error = type(error).__name__
    result = save_result()
    # Log measurements only; transcript is written to the private output file.
    print(json.dumps({'segments': len(segments), 'duration': result['duration'],
                      'processingSeconds': result['processingSeconds']}))


def word_times(content, words):
    """[(start, word, end)] → [{from, to, start, end}] in UTF-16 offsets of content; None if a word is missing."""
    result, offset = [], 0
    for start, word, end in words:
        value = word.strip()
        at = content.find(value, offset)
        if not value or at < 0:
            return None
        offset = at + len(value)
        result.append({'from': len(content[:at].encode('utf-16-le')) // 2,
                       'to': len(content[:offset].encode('utf-16-le')) // 2,
                       'start': round(start, 3), 'end': round(end, 3)})
    return result


LOOKAHEAD = 25  # seconds of the next part: longer than the longest VAD piece (20 s)
UNSURE = -1.0    # word log-probability below this marks the segment «проверьте»


class GigaAM:
    """GigaAM v3 RNN-T with punctuation (MIT, Sber) through sherpa-onnx.

    The model reads at most ~25 s at once, so Silero VAD cuts speech at pauses
    into pieces up to 20 s. Same transcribe() shape as faster-whisper.
    """
    def __init__(self, folder, threads):
        import sherpa_onnx as so
        self.so, self.folder, self.threads = so, Path(folder), threads
        self.recognizer = so.OfflineRecognizer.from_transducer(
            encoder=str(self.folder / 'encoder.int8.onnx'), decoder=str(self.folder / 'decoder.onnx'),
            joiner=str(self.folder / 'joiner.onnx'), tokens=str(self.folder / 'tokens.txt'),
            num_threads=threads, feature_dim=64, model_type='nemo_transducer')

    def transcribe(self, path, following=None, skip=0.0):
        import numpy as np
        from faster_whisper.audio import decode_audio
        from types import SimpleNamespace
        audio = decode_audio(path, sampling_rate=16000)
        length = len(audio) / 16000
        audio = audio[int(skip * 16000):]
        if following:
            audio = np.concatenate([audio, decode_audio(following, sampling_rate=16000)[:LOOKAHEAD * 16000]])
        config = self.so.VadModelConfig()
        config.silero_vad.model = str(self.folder / 'silero_vad.onnx')
        config.silero_vad.min_silence_duration = 0.3
        config.silero_vad.min_speech_duration = 0.25
        config.silero_vad.max_speech_duration = 20
        config.sample_rate, config.num_threads = 16000, self.threads
        vad = self.so.VoiceActivityDetector(config, buffer_size_in_seconds=60)
        window = config.silero_vad.window_size

        def segments():
            def ready():
                while not vad.empty():
                    speech = vad.front
                    samples = np.asarray(speech.samples, dtype=np.float32)
                    start = skip + speech.start / 16000
                    vad.pop()  # frees speech.samples: read everything above first
                    if start >= length:  # belongs to the next part
                        return
                    stream = self.recognizer.create_stream()
                    stream.accept_waveform(16000, samples)
                    self.recognizer.decode_stream(stream)
                    result = stream.result
                    words = []  # subword tokens joined into words; a token with a space starts a word
                    for token, at, chance in zip(result.tokens, result.timestamps, result.ys_log_probs):
                        if token.startswith(' ') or not words:
                            words.append([start + at, token, chance < UNSURE])
                        else:
                            words[-1][1] += token
                            words[-1][2] = words[-1][2] or chance < UNSURE
                    yield SimpleNamespace(start=start, end=start + len(samples) / 16000,
                                          text=result.text, words=words)
            for offset in range(0, len(audio), window):
                vad.accept_waveform(audio[offset:offset + window])
                yield from ready()
            vad.flush()
            yield from ready()
        return segments(), SimpleNamespace(duration=length, language='ru')


if __name__ == '__main__':
    main()
