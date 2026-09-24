# App icons: three lines of text and a sound arc, ink on signal yellow.
#   py build/make-icons.py
from PIL import Image, ImageDraw
INK = (27, 27, 24, 255); SIGNAL = (255, 212, 0, 255)
def icon(size, safe):
    s = 4  # supersample
    W = size * s
    im = Image.new('RGBA', (W, W), SIGNAL)
    d = ImageDraw.Draw(im)
    pad = W * (0.5 - safe / 2)          # content box inside the safe zone
    box = W * safe
    x0 = pad + box * 0.02
    lh = box * 0.105
    for i, frac in enumerate([0.56, 0.56, 0.36]):
        y = pad + box * (0.27 + i * 0.2)
        d.rounded_rectangle([x0, y, x0 + box * frac, y + lh], radius=lh / 2, fill=INK)
    cx, cy = pad + box * 0.64, pad + box * 0.5
    for r, w in [(box * 0.17, box * 0.075), (box * 0.33, box * 0.075)]:
        d.arc([cx - r, cy - r, cx + r, cy + r], start=-50, end=50, fill=INK, width=int(w))
    return im.resize((size, size), Image.LANCZOS)
out = 'app/icons/'
icon(192, 0.8).save(out + 'icon-192.png')
icon(512, 0.8).save(out + 'icon-512.png')
icon(512, 0.62).save(out + 'icon-maskable-512.png')
icon(180, 0.8).convert('RGB').save(out + 'apple-touch-icon.png')
print('icons written')
