# -*- coding: utf-8 -*-
"""终局插画合成：把人物剪影（透明背景）叠放在背景图上，输出 base64。

布局：剪影缩放至背景高度的约 55%，沿底部一行等距排布（居中），
保留少量底边距，模拟『幸存者站在村庄前』的构图。
着色：剪影按结局重新着色为亮色——胜利暖金（呼应晨光）、失败冷银蓝
（呼应月夜），与暗色背景（实测底部亮度 35-51）形成强对比，确保肉眼可辨；
剪影资产本身的深蓝填充色与背景亮度太近，直接叠放几乎不可见。
用法：python3 compose_ending.py <背景图> [--win|--lose] [剪影1 剪影2 ...]
输出：合成图的 base64（stdout）
"""
import base64
import io
import sys

from PIL import Image, ImageFilter

WIN_COLOR = (238, 200, 106)   # 胜利剪影色：暖金（亮度约 196）
LOSE_COLOR = (158, 190, 232)  # 失败剪影色：冷银蓝（亮度约 182）
OUTLINE_COLOR = (16, 20, 28)  # 描边色：深色——亮色剪影配深描边，任何背景上都清晰


def recolor(im, color):
    """把剪影的非透明像素统一替换为目标色（保留 alpha 做抗锯齿边缘）。"""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a > 0:
                px[x, y] = (*color, a)
    return im


def add_outline(im, color=OUTLINE_COLOR):
    """为剪影加描边：alpha 通道膨胀 2px 作为描边蒙版，深色描边垫在剪影下层。"""
    alpha = im.getchannel('A')
    dilated = alpha.filter(ImageFilter.MaxFilter(5))  # 膨胀约 2px
    outline = Image.new('RGBA', im.size, (*color, 255))
    outline.putalpha(dilated)
    merged = Image.new('RGBA', im.size, (0, 0, 0, 0))
    merged.paste(outline, (0, 0), outline)  # 描边垫底
    merged.paste(im, (0, 0), im)  # 剪影在上（覆盖描边内部）
    return merged


def compose(bg_path, silhouette_paths, color):
    bg = Image.open(bg_path).convert('RGBA')
    # 裁剪为 4:3 横版（居中偏上，保留天空与地平线）——横版比例与弹窗宽度匹配，
    # contain 完整显示时铺满宽度无留白（正方形会在宽弹窗左右留白）
    W0, H0 = bg.size
    target_h = int(W0 * 3 / 4)  # 4:3
    if H0 > target_h:
        top = max(0, int(H0 * 0.18))  # 偏上裁剪：保留更多天空，剪掉过暗的地面底部
        bg = bg.crop((0, top, W0, min(H0, top + target_h)))
    W, H = bg.size
    n = len(silhouette_paths)
    if not n:
        out = bg  # 无剪影：直接返回背景
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
            im = im.resize((nw, target_h), Image.LANCZOS)
            imgs.append(add_outline(recolor(im, color)))  # 重新着色为亮色并加深色描边
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
    args = sys.argv[1:]
    if not args:
        print('用法: python3 compose_ending.py <背景图> [--win|--lose] [剪影1 剪影2 ...]', file=sys.stderr)
        sys.exit(1)
    bg_path = args[0]
    rest = args[1:]
    color = LOSE_COLOR
    if '--win' in rest:
        color = WIN_COLOR
        rest = [a for a in rest if a != '--win']
    elif '--lose' in rest:
        rest = [a for a in rest if a != '--lose']
    compose(bg_path, rest, color)
