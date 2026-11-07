#!/usr/bin/env python3
# A GIF of frames at one pixel a game pixel: gif.py [--ms=250] <out.gif> <frame.png> ... (the frames are 3x screenshots: every third pixel,
# nearest, so a game pixel stays a pixel), each played for --ms (the game time between them: real time), looping. Its palette is the frames' own
# colours (the game's few hundred), so nothing new is mixed in.
import sys

from PIL import Image

args = sys.argv[1:]
ms = 250
if args and args[0].startswith('--ms='):
    ms = int(float(args.pop(0)[5:]))
out, files = args[0], args[1:]
frames = []
for f in files:
    im = Image.open(f).convert('RGB')
    frames.append(im.resize((im.width // 3, im.height // 3), Image.NEAREST))
# (one palette for them all, from a strip of every frame: the colours the frames hold, up to 256)
strip = Image.new('RGB', (frames[0].width, frames[0].height * len(frames)))
for i, im in enumerate(frames):
    strip.paste(im, (0, i * im.height))
pal = strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in frames]
q[0].save(out, save_all=True, append_images=q[1:], duration=ms, loop=0, optimize=False)
print(out, len(q), 'frames,', ms, 'ms each')
