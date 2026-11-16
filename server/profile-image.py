import io
import sys
import warnings
from PIL import Image, ImageOps

warnings.simplefilter('error', Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS = 20000000
payload = sys.stdin.buffer.read(5000001)
if not payload or len(payload) > 5000000:
    raise ValueError('image_size')
with Image.open(io.BytesIO(payload)) as source:
    if source.format not in ('JPEG', 'PNG', 'WEBP'):
        raise ValueError('image_format')
    source.load()
    image = ImageOps.exif_transpose(source).convert('RGBA')
    image.thumbnail((512, 512))
    image.info.clear()
    image.save(sys.stdout.buffer, format='PNG')
