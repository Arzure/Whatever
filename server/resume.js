/**
 * 简历图合成模块（方案 A：文字 100% 准确的根治方案）。
 * 原理：图像模型只生成『无文字的背景模板』（配色/构图/装饰），
 * 全部文字由 SVG + sharp 程序化绘制——浏览器级文字渲染，零乱码。
 * 背景：用户反馈生图模型渲染中文小字是概率性乱码（多轮提示词调优无法根治），
 * 换赛道：不让模型画文字，文字交给确定性渲染。
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const FONT_FAMILY = 'Noto Sans SC'; // 已注册到系统字体（server/fonts/NotoSansSC.ttf）

/** 解析简历文本：每行一条目，『字段：值』结构 */
function parseResume(text) {
  const items = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([^：:]{1,8})[：:]\s*(.+)$/);
    if (m) items.push({ field: m[1].trim(), value: m[2].trim() });
    else items.push({ field: '', value: t });
  }
  return items;
}

/** 提取结构化简历数据：姓名/职位 + 各分类条目 */
function structureResume(items) {
  const name = items.find((x) => x.field === '姓名')?.value || '无名';
  const title = items.find((x) => x.field === '职位')?.value || '';
  const sections = [];
  for (const it of items) {
    if (it.field === '姓名' || it.field === '职位') continue;
    const sec = sections.find((s) => s.name === it.field);
    if (sec) sec.lines.push(it.value);
    else sections.push({ name: it.field || '其他', lines: [it.value] });
  }
  return { name, title, sections };
}

/** 文本换行：按显示宽度拆行（中文按 1、ASCII 按 0.55 估宽） */
function wrapText(text, maxUnits) {
  const lines = [];
  let cur = '';
  let w = 0;
  for (const ch of String(text)) {
    const cw = /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(ch) ? 1 : 0.55;
    if (w + cw > maxUnits && cur) {
      lines.push(cur);
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** XML 转义 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 组装简历文字层 SVG（1536×2720 竖版）。
 * 版面：顶部封面（姓名+职位）→ 各分类模块（标题+条目）→ 底部留白。
 * 文字全部程序化绘制，坐标确定性计算，无任何模型参与。
 */
function buildResumeSvg(data, palette) {
  const W = 1536, H = 2720;
  const PAD = 96;
  const parts = [];

  // 顶部封面区：姓名超大加粗 + 职位标签
  parts.push(`<text x="${PAD}" y="300" font-family="${FONT_FAMILY}" font-size="120" font-weight="700" fill="${palette.text}">${esc(data.name)}</text>`);
  if (data.title) {
    parts.push(`<rect x="${PAD}" y="345" width="${Math.ceil(data.title.length * 44 + 56)}" height="72" rx="36" fill="${palette.accent}" opacity="0.9"/>`);
    parts.push(`<text x="${PAD + 28}" y="394" font-family="${FONT_FAMILY}" font-size="36" fill="${palette.onAccent}">${esc(data.title)}</text>`);
  }

  // 分类模块：从封面下方开始，逐模块绘制
  let y = 520;
  const maxUnits = Math.floor((W - PAD * 2) / 34); // 正文字号 34 的每行容量
  for (const sec of data.sections) {
    if (y > H - 200) break; // 超出画布保护
    // 模块标题：强调色竖条 + 标题文字
    parts.push(`<rect x="${PAD}" y="${y}" width="10" height="44" rx="5" fill="${palette.accent}"/>`);
    parts.push(`<text x="${PAD + 30}" y="${y + 36}" font-family="${FONT_FAMILY}" font-size="42" font-weight="700" fill="${palette.text}">${esc(sec.name)}</text>`);
    y += 80;
    // 模块条目：每条一行（超宽自动换行）
    for (const line of sec.lines) {
      for (const sub of wrapText(line, maxUnits)) {
        if (y > H - 120) break;
        parts.push(`<text x="${PAD + 30}" y="${y}" font-family="${FONT_FAMILY}" font-size="34" fill="${palette.textDim}">${esc(sub)}</text>`);
        y += 56;
      }
      y += 16; // 条目间距
    }
    y += 40; // 模块间距
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

/**
 * 合成简历图：AI 背景模板 + 程序化文字层。
 * bgBuffer：图像模型生成的无文字背景（1536×2720）；data：结构化简历数据。
 * 返回合成后的 WebP Buffer。
 */
async function composeResume(bgBuffer, data, palette) {
  const svg = buildResumeSvg(data, palette);
  const textLayer = await sharp(Buffer.from(svg)).png().toBuffer();
  return sharp(bgBuffer)
    .resize(1536, 2720, { fit: 'cover' })
    .composite([{ input: textLayer }])
    .webp({ quality: 92 })
    .toBuffer();
}

/** 生成无文字背景模板的提示词（图像模型只管配色构图，不画任何文字） */
function buildBackgroundPrompt(style) {
  const styleLine = style && style.trim() ? `整体风格：${style.trim()}。` : '整体风格：现代专业设计，配色克制和谐。';
  return [
    '一张竖版抽象设计背景图，用作简历海报的底图。',
    styleLine,
    '要求：顶部约 1/5 是视觉重心区（大色块或渐变），下方大面积留出干净的浅色区域；有细腻的几何装饰与纹理层次；构图简洁优雅，专业感强。',
    '严禁出现任何文字、字母、数字、符号——这是一张纯背景图，文字会由其他程序叠加。',
  ].join('\n');
}

module.exports = { parseResume, structureResume, composeResume, buildBackgroundPrompt, FONT_FAMILY };
