#!/usr/bin/env python3
# A GIF of frames at one pixel a game pixel: gif.py <out.gif> <frame.png> ... (the frames are 3x screenshots: every third pixel, nearest, so
# a game pixel stays a pixel), 0.25 s of game time a frame played at 0.12 s, looping. Its palette is the frames' own colours (the game's few
# hundred), so nothing new is mixed in.
import sys

from PIL import Image

out, files = sys.argv[1], sys.argv[2:]
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
q[0].save(out, save_all=True, append_images=q[1:], duration=120, loop=0, optimize=False)
print(out, len(q), 'frames')
