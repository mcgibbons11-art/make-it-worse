#!/usr/bin/env python3
"""Sample flat regions of a render and of the reference so a pass review quotes
measured values instead of an impression. Regions are normalized (x, y, w, h).

usage: python sample_render.py <image> [region=x,y,w,h ...]
"""
from __future__ import annotations
import struct, sys, zlib

DEFAULT_REGIONS = {
    "wall-a-face": (0.22, 0.24, 0.06, 0.10),
    "wall-b-face": (0.66, 0.20, 0.08, 0.10),
    "floor-tan": (0.42, 0.66, 0.08, 0.05),
    "trim-navy": (0.30, 0.855, 0.05, 0.012),
    "sofa": (0.72, 0.51, 0.05, 0.03),
    "table": (0.30, 0.53, 0.04, 0.03),
    "background": (0.02, 0.04, 0.05, 0.05),
}


def load(path):
    data = open(path, "rb").read()
    pos, idat = 8, b""
    width = height = ctype = 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, _, ctype = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    cursor = 0
    for y in range(height):
        filt = raw[cursor]
        cursor += 1
        line = bytearray(raw[cursor:cursor + stride])
        cursor += stride
        if filt == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif filt == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((left + prev[x]) >> 1)) & 255
        elif filt == 4:
            for x in range(stride):
                left = line[x - channels] if x >= channels else 0
                up, upleft = prev[x], (prev[x - channels] if x >= channels else 0)
                guess = left + up - upleft
                dl, du, dul = abs(guess - left), abs(guess - up), abs(guess - upleft)
                pick = left if (dl <= du and dl <= dul) else (up if du <= dul else upleft)
                line[x] = (line[x] + pick) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return out, width, height, channels, stride


def main() -> None:
    path = sys.argv[1]
    regions = dict(DEFAULT_REGIONS)
    for argument in sys.argv[2:]:
        name, _, spec = argument.partition("=")
        regions[name] = tuple(float(v) for v in spec.split(","))
    pixels, width, height, channels, stride = load(path)
    print(path, f"{width}x{height}")
    for name, (rx, ry, rw, rh) in regions.items():
        x0, y0 = int(rx * width), int(ry * height)
        x1, y1 = max(x0 + 1, int((rx + rw) * width)), max(y0 + 1, int((ry + rh) * height))
        total = [0, 0, 0]
        count = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                offset = y * stride + x * channels
                for channel in range(3):
                    total[channel] += pixels[offset + channel]
                count += 1
        red, green, blue = (value // count for value in total)
        print(f"  {name:16s} #{red:02x}{green:02x}{blue:02x}")


if __name__ == "__main__":
    main()
