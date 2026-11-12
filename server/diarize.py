"""Local speaker diarization on CPU. No audio leaves the server.

Pipeline: pyannote segmentation 3.0 (ONNX, MIT) + WeSpeaker ResNet34 embeddings
(ONNX, Apache-2.0) through sherpa-onnx. Audio arrives as 15-minute FLAC chunks;
each chunk is diarized separately to keep memory bounded, then speakers are
linked across chunks by cosine similarity of their voice embeddings.

The result labels transcript segments "Спикер N" in order of first
appearance. Names are never guessed: people rename speakers in the interface.

CLI (re-label an existing transcript without running Whisper again):
  python diarize.py AUDIO_DIR SEGMENTS_JSON OUTPUT_JSON --models DIR
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import time

SAMPLE_RATE = 16000
LABEL = 'Спикер'


def models_ready(models: str | os.PathLike) -> bool:
    folder = Path(models)
    return (folder / 'segmentation.onnx').is_file() and (folder / 'embedding.onnx').is_file()


def _cosine(a, b) -> float:
    import numpy as np
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(np.dot(a, b) / (na * nb)) if na and nb else 0.0


def diarize_chunks(chunks: list[Path], models: str, threads: int = 1,
                   threshold: float = 0.7, link: float = 0.55, minimum: float = 10.0,
                   on_progress=None):
    """Returns [(start, end, speaker_index)] in recording time and total speakers."""
    import numpy as np
    import sherpa_onnx as so
    from faster_whisper.audio import decode_audio

    folder = Path(models)
    config = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(folder / 'segmentation.onnx')),
            num_threads=threads),
        embedding=so.SpeakerEmbeddingExtractorConfig(model=str(folder / 'embedding.onnx'), num_threads=threads),
        clustering=so.FastClusteringConfig(num_clusters=-1, threshold=threshold),
        min_duration_on=0.3, min_duration_off=0.5)
    if not config.validate():
        raise RuntimeError('diarization config is invalid')
    diarizer = so.OfflineSpeakerDiarization(config)
    extractor = so.SpeakerEmbeddingExtractor(so.SpeakerEmbeddingExtractorConfig(
        model=str(folder / 'embedding.onnx'), num_threads=threads))

    voices: list = []          # global speaker centroids
    spoken: list[float] = []   # seconds per global speaker
    turns: list[tuple[float, float, int]] = []
    offset = 0.0
    for index, chunk in enumerate(chunks, 1):
        if on_progress:
            on_progress(offset, index, len(chunks))
        audio = decode_audio(str(chunk), sampling_rate=SAMPLE_RATE)
        result = diarizer.process(audio).sort_by_start_time()
        local: dict[int, list[tuple[float, float]]] = {}
        for r in result:
            local.setdefault(r.speaker, []).append((r.start, r.end))
        mapping: dict[int, int] = {}
        used: set[int] = set()
        # Longest local speakers pick their global match first.
        for speaker, parts in sorted(local.items(), key=lambda kv: -sum(e - s for s, e in kv[1])):
            take, total = [], 0.0
            for s, e in sorted(parts, key=lambda p: p[0] - p[1]):
                if total >= 30:
                    break
                take.append(audio[int(s * SAMPLE_RATE):int(e * SAMPLE_RATE)])
                total += e - s
            samples = np.concatenate(take) if take else np.zeros(0, dtype=np.float32)
            vector = None
            if len(samples) >= SAMPLE_RATE:
                stream = extractor.create_stream()
                stream.accept_waveform(SAMPLE_RATE, samples)
                stream.input_finished()
                vector = np.array(extractor.compute(stream), dtype=np.float32)
            best, score = -1, link
            if vector is not None:
                for voice_index, centroid in enumerate(voices):
                    if voice_index in used:
                        continue
                    value = _cosine(vector, centroid)
                    if value >= score:
                        best, score = voice_index, value
            if best < 0:
                voices.append(vector if vector is not None else np.zeros(1, dtype=np.float32))
                spoken.append(0.0)
                best = len(voices) - 1
            elif vector is not None:
                weight = spoken[best]
                voices[best] = (voices[best] * weight + vector * total) / max(weight + total, 1e-6)
            used.add(best)
            spoken[best] += sum(e - s for s, e in parts)
            mapping[speaker] = best
        for r in result:
            turns.append((offset + r.start, offset + r.end, mapping[r.speaker]))
        offset += len(audio) / SAMPLE_RATE
        if on_progress:
            on_progress(offset, index, len(chunks))

    # Voices heard for less than `minimum` seconds are usually noise or overlap:
    # attach them to the most similar real voice instead of inventing a person.
    keep = [i for i, seconds in enumerate(spoken) if seconds >= minimum] or \
           ([max(range(len(spoken)), key=lambda i: spoken[i])] if spoken else [])
    merge = {}
    for i in range(len(spoken)):
        if i in keep:
            merge[i] = i
        else:
            merge[i] = max(keep, key=lambda k: _cosine(voices[i], voices[k]) if voices[i].shape == voices[k].shape else -1)
    return [(s, e, merge[k]) for s, e, k in turns], len(keep)


def label_segments(segments: list[dict], turns: list[tuple[float, float, int]]) -> tuple[list[dict], int]:
    """Assigns each transcript segment the speaker with the largest time overlap."""
    order: dict[int, int] = {}
    previous = None
    for segment in segments:
        start = float(segment.get('time') or 0)
        end = float(segment.get('end') or start + 1)
        overlap: dict[int, float] = {}
        for s, e, k in turns:
            if e <= start or s >= end:
                continue
            overlap[k] = overlap.get(k, 0.0) + min(e, end) - max(s, start)
        if overlap:
            speaker = max(overlap, key=overlap.get)
        else:
            near = min(turns, key=lambda t: min(abs(t[0] - start), abs(t[1] - start)), default=None)
            speaker = near[2] if near and min(abs(near[0] - start), abs(near[1] - start)) <= 1.5 else previous
        if speaker is None:
            continue
        previous = speaker
        if speaker not in order:
            order[speaker] = len(order) + 1
        segment['speaker'] = f'{LABEL} {order[speaker]}'
    return segments, len(order)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('segments')
    parser.add_argument('output')
    parser.add_argument('--models', required=True)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--duration', type=float, default=0)
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    segments = json.loads(Path(args.segments).read_text(encoding='utf-8'))
    def progress(done, index, total):
        print(json.dumps({'event': 'progress', 'phase': 'diarization',
                          'processedSeconds': round(min(done, args.duration), 2),
                          'totalSeconds': args.duration, 'chunk': index, 'chunks': total}), flush=True)
    turns, _ = diarize_chunks(sorted(Path(args.audio).glob('audio-*.flac')), args.models, max(1, args.threads),
                              float(os.environ.get('ASR_DIARIZATION_THRESHOLD', '0.7')), on_progress=progress)
    segments, count = label_segments(segments, turns)
    result = {'speakers': {s['id']: s['speaker'] for s in segments if 'id' in s and s.get('speaker', '').startswith(LABEL)},
              'count': count, 'engine': 'pyannote-segmentation-3.0 + WeSpeaker ResNet34',
              'processingSeconds': round(time.monotonic() - started, 2)}
    output = Path(args.output)
    temporary = output.with_suffix('.part')
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    temporary.replace(output)
    print(json.dumps({'count': count, 'processingSeconds': result['processingSeconds']}))


if __name__ == '__main__':
    main()
