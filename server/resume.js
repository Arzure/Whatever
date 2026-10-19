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

  // 顶部封面区：姓名超大加粗 + 职位胶囊标签 + 封面底部装饰线
  parts.push(`<text x="${PAD}" y="290" font-family="${FONT_FAMILY}" font-size="120" font-weight="700" fill="${palette.text}">${esc(data.name)}</text>`);
  if (data.title) {
    parts.push(`<rect x="${PAD}" y="335" width="${Math.ceil(data.title.length * 44 + 56)}" height="72" rx="36" fill="${palette.accent}" opacity="0.92"/>`);
    parts.push(`<text x="${PAD + 28}" y="${384}" font-family="${FONT_FAMILY}" font-size="36" fill="${palette.onAccent}">${esc(data.title)}</text>`);
  }
  parts.push(`<rect x="${PAD}" y="460" width="${W - PAD * 2}" height="4" rx="2" fill="${palette.accent}" opacity="0.45"/>`);

  // 分类模块：按类型差异化呈现（参考旧版设计：联系卡片/技能胶囊/经历时间线）
  let y = 540;
  const maxUnits = Math.floor((W - PAD * 2 - 60) / 34);
  for (const sec of data.sections) {
    if (y > H - 200) break;
    const isSkills = sec.name.includes('技能');
    const isContact = sec.name.includes('联系');
    const isExp = sec.name.includes('经历');

    // 联系方式模块：半透明白色圆角卡片底（模拟旧版联系卡片）
    if (isContact) {
      const cardH = 100 + sec.lines.length * 56;
      parts.push(`<rect x="${PAD - 20}" y="${y - 24}" width="${W - PAD * 2 + 40}" height="${cardH}" rx="24" fill="#ffffff" opacity="0.72"/>`);
    }

    // 模块标题：强调色竖条 + 标题 + 右侧装饰短线
    parts.push(`<rect x="${PAD}" y="${y}" width="10" height="44" rx="5" fill="${palette.accent}"/>`);
    parts.push(`<text x="${PAD + 30}" y="${y + 36}" font-family="${FONT_FAMILY}" font-size="42" font-weight="700" fill="${palette.text}">${esc(sec.name)}</text>`);
    parts.push(`<rect x="${PAD + 56 + sec.name.length * 42}" y="${y + 20}" width="120" height="4" rx="2" fill="${palette.accent}" opacity="0.35"/>`);
    y += 84;

    if (isSkills) {
      // 技能模块：深色胶囊标签流式排布（模拟旧版技能标签墙）
      let tx = PAD + 30, ty = y;
      for (const line of sec.lines) {
        for (const tag of line.split(/[\s,，、/]+/).filter(Boolean)) {
          const tw = Math.ceil(tag.length * 30 + 48);
          if (tx + tw > W - PAD) { tx = PAD + 30; ty += 76; }
          if (ty > H - 120) break;
          parts.push(`<rect x="${tx}" y="${ty}" width="${tw}" height="60" rx="30" fill="${palette.text}" opacity="0.88"/>`);
          parts.push(`<text x="${tx + 24}" y="${ty + 40}" font-family="${FONT_FAMILY}" font-size="30" fill="#ffffff">${esc(tag)}</text>`);
          tx += tw + 18;
        }
      }
      y = ty + 110;
    } else if (isExp) {
      // 经历模块：时间线（强调色竖线 + 首条目实心节点，模拟旧版时间轴）
      const LX = PAD + 46;
      const entries = [];
      for (const line of sec.lines) entries.push(...wrapText(line, maxUnits - 4));
      const blockH = entries.length * 56 + 30;
      parts.push(`<line x1="${LX}" y1="${y}" x2="${LX}" y2="${y + blockH}" stroke="${palette.accent}" stroke-width="3" opacity="0.4"/>`);
      let ey = y + 14;
      entries.forEach((sub, i) => {
        if (ey > H - 120) return;
        if (i === 0) parts.push(`<circle cx="${LX}" cy="${ey - 10}" r="11" fill="${palette.accent}"/>`);
        parts.push(`<text x="${LX + 36}" y="${ey}" font-family="${FONT_FAMILY}" font-size="34" fill="${palette.textDim}">${esc(sub)}</text>`);
        ey += 56;
      });
      y = ey + 40;
    } else {
      // 普通模块（教育等）：条目列表（超宽自动换行）
      for (const line of sec.lines) {
        for (const sub of wrapText(line, maxUnits)) {
          if (y > H - 120) break;
          parts.push(`<text x="${PAD + 30}" y="${y}" font-family="${FONT_FAMILY}" font-size="34" fill="${palette.textDim}">${esc(sub)}</text>`);
          y += 56;
        }
        y += 16;
      }
      y += 44;
    }
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
