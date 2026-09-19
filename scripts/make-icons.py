# Draws the Ammmaa icons (a chat bubble with "typing" dots). Needs Pillow: pip install pillow
from PIL import Image, ImageDraw

PEACOCK = (12, 75, 71, 255)
ZARI = (242, 182, 50, 255)
SILK = (179, 20, 95, 255)

def bubble(d, box, radius, fill, tail=True):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=radius, fill=fill)
    if tail:
        w = x1 - x0
        d.polygon([(x0 + w * 0.10, y1 - radius * 0.6), (x0 + w * 0.10, y1 + w * 0.13), (x0 + w * 0.34, y1 - radius * 0.2)], fill=fill)

def dots(d, box, r, fill):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    gap = (x1 - x0) * 0.22
    for i in (-1, 0, 1):
        d.ellipse((cx + i * gap - r, cy - r, cx + i * gap + r, cy + r), fill=fill)

def icon(size, bg='rounded', scale=1.0, out=None):
    S = 4
    n = size * S
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg == 'rounded':
        d.rounded_rectangle((0, 0, n - 1, n - 1), radius=int(n * 0.22), fill=PEACOCK)
    else:
        d.rectangle((0, 0, n, n), fill=PEACOCK)
    bw, bh = n * 0.60 * scale, n * 0.40 * scale
    cx, cy = n / 2, n * 0.47
    box = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
    bubble(d, box, bh * 0.42, ZARI)
    dots(d, box, bh * 0.085, PEACOCK)
    # a silk-magenta bindi above the bubble's corner
    r = n * 0.045 * scale
    d.ellipse((box[2] - r * 2.2, box[1] - r * 3.2, box[2] - r * 0.2, box[1] - r * 1.2), fill=SILK)
    im = im.resize((size, size), Image.LANCZOS)
    if out:
        im.save(out)
    return im

def badge(size, out):
    S = 4
    n = size * S
    mask = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(mask)
    bw, bh = n * 0.78, n * 0.52
    box = ((n - bw) / 2, n * 0.14, (n + bw) / 2, n * 0.14 + bh)
    bubble(d, box, bh * 0.42, 255)
    dots(d, box, bh * 0.10, 0)
    mask = mask.resize((size, size), Image.LANCZOS)
    im = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    im.putalpha(mask)
    im.save(out)

icon(192, 'rounded', 1.0, 'public/icons/icon-192.png')
icon(512, 'rounded', 1.0, 'public/icons/icon-512.png')
icon(512, 'full', 0.78, 'public/icons/icon-maskable-512.png')   # keep art inside the 80% safe zone
icon(180, 'full', 0.9, 'public/icons/apple-touch-icon.png')      # iOS wants an opaque square
badge(96, 'public/icons/badge-96.png')
print('icons written')
