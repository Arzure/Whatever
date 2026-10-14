# -*- coding: utf-8 -*-
"""终局插画合成：把人物剪影（透明背景）叠放在背景图上，输出 base64。

布局：剪影缩放到背景高度的约 55%，沿底部一行等距排布（居中），
保留少量底边距，模拟『幸存者站在村庄前』的构图。
用法：python3 compose_ending.py <背景图> [剪影1 剪影2 ...]
输出：合成图的 base64（stdout）
"""
import base64
import io
import sys

from PIL import Image


def compose(bg_path, silhouette_paths):
    bg = Image.open(bg_path).convert('RGBA')
    W, H = bg.size
    n = len(silhouette_paths)
    if not n:
        # 无剪影：直接返回背景
        out = bg
    else:
        # 剪影目标高度：背景的 55%；最多 10 人时略缩小避免拥挤
        target_h = int(H * (0.55 if n <= 5 else 0.48))
        bottom_margin = int(H * 0.04)
        imgs = []
        for p in silhouette_paths:
            im = Image.open(p).convert('RGBA')
            # 等比缩放到目标高度
            ratio = target_h / im.height
            nw = max(1, int(im.width * ratio))
            imgs.append(im.resize((nw, target_h), Image.LANCZOS))
        # 等距排布：总宽度不超过背景的 88%，超出则整体等比压缩
        total_w = sum(im.width for im in imgs)
        max_w = int(W * 0.88)
        if total_w > max_w:
            scale = max_w / total_w
            imgs = [im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS) for im in imgs]
            total_w = sum(im.width for im in imgs)
        gap = (max_w - total_w) // (n + 1) if n > 1 else (W - total_w) // 2
        if n == 1:
            gap = (W - total_w) // 2
        x = gap if n > 1 else (W - total_w) // 2
        y = H - imgs[0].height - bottom_margin
        for im in imgs:
            bg.paste(im, (x, y), im)  # 以 alpha 蒙版叠放（透明背景正确合成）
            x += im.width + gap
        out = bg
    buf = io.BytesIO()
    out.convert('RGB').save(buf, format='PNG')
    sys.stdout.write(base64.b64encode(buf.getvalue()).decode())


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python3 compose_ending.py <背景图> [剪影1 剪影2 ...]', file=sys.stderr)
        sys.exit(1)
    compose(sys.argv[1], sys.argv[2:])
