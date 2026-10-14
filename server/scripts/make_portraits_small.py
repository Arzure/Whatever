# -*- coding: utf-8 -*-
"""立绘资产批量缩放：把 portraits/ 的 512x512 立绘缩到 96x96 存入 portraits-small/。
96 = 44px 显示尺寸的 2 倍余量（兼顾高分屏清晰度），体积约降至 1/20，显著省流量加速显示。
用法：python3 make_portraits_small.py（可重复运行，幂等覆盖）
"""
import glob
import os

from PIL import Image

SRC = '/home/ubuntu/Whatever/server/assets/portraits'
DST = '/home/ubuntu/Whatever/server/assets/portraits-small'
SIZE = (96, 96)

os.makedirs(DST, exist_ok=True)
files = sorted(glob.glob(SRC + '/*.png'))
print('待缩放:', len(files), '张 ->', SIZE)
total_src = total_dst = 0
for f in files:
    im = Image.open(f).convert('RGBA')
    small = im.resize(SIZE, Image.LANCZOS)
    out = os.path.join(DST, os.path.basename(f))
    small.save(out, optimize=True)
    total_src += os.path.getsize(f)
    total_dst += os.path.getsize(out)
print('完成：%d 张；总体积 %.1fKB -> %.1fKB（%.1f%%）' % (
    len(files), total_src / 1024, total_dst / 1024, 100 * total_dst / total_src))
