# -*- coding: utf-8 -*-
"""剪影处理：把纯黑背景的人物剪影图转为透明背景 + 纯色剪影。

原理：生图产出的人物亮度普遍偏低（实测 32-63/255），直接保留原色
近乎黑底黑影无法分辨。因此采用二值化 + 纯色填充：
- 亮度低于阈值 → 背景完全透明；
- 亮度高于阈值 → 填充固定剪影色（深蓝），保证任何生成结果都清晰可见；
- 过渡带（阈值上下各半）→ 半透明纯色，边缘平滑抗锯齿。
用法：python3 process_silhouette.py <图片路径>
"""
import sys

from PIL import Image

SILHOUETTE_COLOR = (30, 58, 95)  # 剪影填充色：深蓝（与背景图配色一致）


def process(path):
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    px = img.load()
    # 实测亮度分桶：背景 0-31（约 85%），人物 32-63（约 15%），以 32 为界
    THRESHOLD = 32
    BAND = 12  # 过渡带宽度（阈值下方），边缘平滑
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum >= THRESHOLD:
                # 人物：纯色不透明剪影
                px[x, y] = (*SILHOUETTE_COLOR, 255)
            elif lum >= THRESHOLD - BAND:
                # 过渡带：半透明纯色（抗锯齿边缘）
                alpha = int(255 * (lum - (THRESHOLD - BAND)) / BAND)
                px[x, y] = (*SILHOUETTE_COLOR, alpha)
            else:
                # 背景：完全透明
                px[x, y] = (0, 0, 0, 0)
    img.save(path)
    print('处理完成:', path)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python3 process_silhouette.py <图片路径>')
        sys.exit(1)
    process(sys.argv[1])
