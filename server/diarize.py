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
                   on_progress=None, max_speakers=0):
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
    merge = limit_voice_groups(voices, spoken, keep, merge, max_speakers)
    return [(s, e, merge[k]) for s, e, k in turns], len(set(merge.values()))


def limit_voice_groups(voices, spoken, keep, merge, max_speakers):
    if not max_speakers or len(keep) <= max_speakers:
        return merge
    import numpy as np
    import sherpa_onnx as so
    # Apply the limit across the whole recording, after matching chunks.
    reliable = [i for i in keep if len(voices[i]) > 1 and np.linalg.norm(voices[i]) > 0]
    if len(reliable) > max_speakers and max_speakers > 1:
        cluster = so.FastClustering(so.FastClusteringConfig(num_clusters=max_speakers))
        groups = dict(zip(reliable, cluster(np.asarray([voices[i] for i in reliable], dtype=np.float32))))
    else:
        groups = {i: (index if max_speakers > 1 else 0) for index, i in enumerate(reliable)}
    fallback = groups[max(reliable, key=lambda i: spoken[i])] if reliable else 0
    return {i: groups.get(k, fallback) for i, k in merge.items()}


def label_segments(segments: list[dict], turns: list[tuple[float, float, int]]) -> tuple[list[dict], int]:
    """Assigns each transcript segment the speaker with the largest time overlap.

    A segment with word times is first cut where the voice changes, so a moderator's
    question and the start of the answer do not end up in one reply.
    """
    from bisect import bisect_right
    starts = [s for s, _, _ in turns]
    order: dict[int, int] = {}
    previous = None
    labeled = []
    for segment in segments:
        for part, speaker in _split_by_voice(segment, turns, starts, bisect_right):
            if speaker is None:
                speaker = _overlap_speaker(part, turns, previous)
            labeled.append(part)
            if speaker is None:
                continue
            previous = speaker
            if speaker not in order:
                order[speaker] = len(order) + 1
            part['speaker'] = f'{LABEL} {order[speaker]}'
    return labeled, len(order)


def _overlap_speaker(segment, turns, previous):
    start = float(segment.get('time') or 0)
    end = float(segment.get('end') or start + 1)
    overlap: dict[int, float] = {}
    for s, e, k in turns:
        if e <= start or s >= end:
            continue
        overlap[k] = overlap.get(k, 0.0) + min(e, end) - max(s, start)
    if overlap:
        return max(overlap, key=overlap.get)
    near = min(turns, key=lambda t: min(abs(t[0] - start), abs(t[1] - start)), default=None)
    return near[2] if near and min(abs(near[0] - start), abs(near[1] - start)) <= 1.5 else previous


def _split_by_voice(segment, turns, starts, bisect_right, shortest=1.0):
    """Yields (part, speaker or None). Voice runs under `shortest` seconds or one word are noise."""
    words = segment.get('words') or []
    if len(words) < 2 or not turns:
        yield segment, None
        return
    def voice(at):
        index = bisect_right(starts, at) - 1
        found = [k for s, e, k in turns[max(0, index - 5):index + 1] if s <= at < e]
        return found[-1] if found else None
    labels = [voice(at) for at, _, _ in words]
    for i in range(1, len(labels)):          # a word between turns keeps the previous voice
        if labels[i] is None:
            labels[i] = labels[i - 1]
    for i in range(len(labels) - 2, -1, -1):
        if labels[i] is None:
            labels[i] = labels[i + 1]
    runs = []                                # [speaker, first word, last word + 1]
    for i, label in enumerate(labels):
        if runs and runs[-1][0] == label:
            runs[-1][2] = i + 1
        else:
            runs.append([label, i, i + 1])
    def seconds(run):
        return (words[run[2]][0] if run[2] < len(words) else segment['end']) - words[run[1]][0]
    merged = True
    while merged and len(runs) > 1:
        merged = False
        for i, run in enumerate(runs):
            if run[2] - run[1] < 2 or seconds(run) < shortest:
                neighbour = runs[i - 1] if i else runs[1]
                neighbour[1], neighbour[2] = min(neighbour[1], run[1]), max(neighbour[2], run[2])
                del runs[i]
                merged = True
                break
        for i in range(len(runs) - 1, 0, -1):  # neighbours with the same voice become one run
            if runs[i][0] == runs[i - 1][0]:
                runs[i - 1][2] = runs[i][2]
                del runs[i]
    # Voice turns lag the words by about one word: cut only at the nearest end of a
    # sentence within 1.5 s of the change, and give each piece its majority voice.
    cuts = set()
    for run in runs[1:]:
        at = words[run[1]][0]
        ends = [c for c in range(1, len(words))
                if words[c - 1][1].rstrip().endswith(('.', '?', '!', '…')) and abs(words[c][0] - at) <= 1.5]
        if ends:
            cuts.add(min(ends, key=lambda c: abs(words[c][0] - at)))
    pieces = []                              # [speaker, first word, last word + 1]
    bounds = [0, *sorted(cuts), len(words)]
    for first, last in zip(bounds, bounds[1:]):
        votes = [label for label in labels[first:last] if label is not None]
        speaker = max(votes, key=votes.count) if votes else None  # a tie goes to the first voice
        if pieces and pieces[-1][0] == speaker:
            pieces[-1][2] = last
        else:
            pieces.append([speaker, first, last])
    if len(pieces) == 1:
        yield segment, pieces[0][0]
        return
    for n, (speaker, first, last) in enumerate(pieces):
        part = {k: v for k, v in segment.items() if k not in ('words', 'uncertain')}
        part['time'] = segment['time'] if n == 0 else words[first][0]
        part['end'] = words[last][0] if last < len(words) else segment['end']
        part['text'] = ''.join(w for _, w, _ in words[first:last]).strip()
        part['words'] = words[first:last]
        if any(u for _, _, u in words[first:last]):
            part['uncertain'] = True
        yield part, speaker


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('segments')
    parser.add_argument('output')
    parser.add_argument('--models', required=True)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--duration', type=float, default=0)
    parser.add_argument('--max-speakers', type=int, default=0)
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    segments = json.loads(Path(args.segments).read_text(encoding='utf-8'))
    def progress(done, index, total):
        print(json.dumps({'event': 'progress', 'phase': 'diarization',
                          'processedSeconds': round(min(done, args.duration), 2),
                          'totalSeconds': args.duration, 'chunk': index, 'chunks': total}), flush=True)
    turns, _ = diarize_chunks(sorted(Path(args.audio).glob('audio-*.flac')), args.models, max(1, args.threads),
                              float(os.environ.get('ASR_DIARIZATION_THRESHOLD', '0.7')), on_progress=progress, max_speakers=args.max_speakers)
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
