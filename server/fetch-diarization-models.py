"""Downloads the speaker diarization models at image build time and verifies SHA-256.

pyannote segmentation 3.0 (MIT, CNRS) exported to ONNX by k2-fsa/sherpa-onnx, and
WeSpeaker ResNet34 trained on VoxCeleb (CC BY 4.0). Runtime never downloads anything.
Usage: python fetch-diarization-models.py /app/models/diarization
"""
import hashlib, io, sys, tarfile, urllib.request
from pathlib import Path

BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'
SEGMENTATION = (BASE + 'speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
                '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488')
SEGMENTATION_MODEL = 'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d'
EMBEDDING = (BASE + 'speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx',
             'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012')


def fetch(url: str, digest: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as response:
        data = response.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != digest:
        raise SystemExit(f'checksum mismatch for {url}: {actual}')
    return data


def main():
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(fetch(*SEGMENTATION)), mode='r:bz2') as archive:
        member = archive.getmember('sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx')
        model = archive.extractfile(member).read()
    if hashlib.sha256(model).hexdigest() != SEGMENTATION_MODEL:
        raise SystemExit('segmentation model checksum mismatch')
    (target / 'segmentation.onnx').write_bytes(model)
    (target / 'embedding.onnx').write_bytes(fetch(*EMBEDDING))
    print('diarization models ready in', target)


if __name__ == '__main__':
    main()
