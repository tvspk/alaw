# Vytvoří ikony aplikace (icons/icon-192.png, icon-512.png, icon-maskable-512.png).
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / 'icons'
GREEN, CREAM, RED = (29, 107, 76), (245, 242, 234), (179, 38, 30)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'

def draw(size, maskable, fg_only=False, round_=False):
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if fg_only:
        scale = 0.6   # popředí adaptivní ikony: bezpečná zóna je vnitřních 66 %
    elif round_:
        d.ellipse([0, 0, s - 1, s - 1], fill=GREEN)
        scale = 0.7
    elif maskable:
        d.rectangle([0, 0, s, s], fill=GREEN)
        scale = 0.62
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)
        scale = 0.8
    font = ImageFont.truetype(FONT, int(s * 0.62 * scale))
    box = d.textbbox((0, 0), 'A', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (s - w) / 2 - box[0] - s * 0.05 * scale
    y = (s - h) / 2 - box[1]
    d.text((x, y), 'A', font=font, fill=CREAM)
    r = s * 0.065 * scale
    cx, cy = x + box[2] + r * 1.6, y + box[3] - r
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
    return img.resize((size, size), Image.LANCZOS)

OUT.mkdir(exist_ok=True)
draw(192, False).save(OUT / 'icon-192.png')
draw(512, False).save(OUT / 'icon-512.png')
draw(512, True).save(OUT / 'icon-maskable-512.png')
# Android (mipmap): klasická, kulatá a popředí adaptivní ikony
RES = Path(__file__).resolve().parent.parent / 'android' / 'proj' / 'res'
for name, (leg, fg) in {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}.items():
    out = RES / f'mipmap-{name}'
    out.mkdir(parents=True, exist_ok=True)
    draw(leg, False).save(out / 'ic_launcher.png')
    draw(leg, False, round_=True).save(out / 'ic_launcher_round.png')
    draw(fg, False, fg_only=True).save(out / 'ic_launcher_foreground.png')
print('ikony hotové')
