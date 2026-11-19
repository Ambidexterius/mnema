"""Downloads GigaAM v3 (RNN-T with punctuation, int8) and Silero VAD at image build time and verifies SHA-256.

GigaAM v3 — MIT, © 2024 GigaChat Team (Sber), https://github.com/salute-developers/GigaAM,
ONNX export for sherpa-onnx by k2-fsa. Silero VAD — MIT, https://github.com/snakers4/silero-vad.
Runtime never downloads anything.
Usage: python fetch-asr-model.py /app/models/gigaam-v3
"""
import hashlib, sys, urllib.request
from pathlib import Path

GIGAAM = ('https://huggingface.co/csukuangfj/sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16/'
          'resolve/a6039be7cee829a9044a69ac0ebaf1c191217c97/')
FILES = {
    'encoder.int8.onnx': (GIGAAM, '369f35a71bf288d3b8e0391fabd8dba5f2314088d440bca474056b7b4b6e66bf'),
    'decoder.onnx': (GIGAAM, '38fc7475443ea2a26f63211ca350f73ac50fff824ab7a3876ee2bd610c53bbc4'),
    'joiner.onnx': (GIGAAM, '602ff7017a93311aad34df1437c8d7f49911353c13d6eae7a6ee7b041339465c'),
    'tokens.txt': (GIGAAM, '39abae20e692998290c574e606f11a9edef2902a1995463fcff63d1490cf22b7'),
    'silero_vad.onnx': ('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/',
                        '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'),
}


def main():
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    for name, (base, digest) in FILES.items():
        with urllib.request.urlopen(base + name, timeout=600) as response:
            data = response.read()
        actual = hashlib.sha256(data).hexdigest()
        if actual != digest:
            raise SystemExit(f'checksum mismatch for {name}: {actual}')
        (target / name).write_bytes(data)
    print('ASR model ready in', target)


if __name__ == '__main__':
    main()
