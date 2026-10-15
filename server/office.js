/**
 * 办公助手（阶段 1）：信息图 + 简历图生成。
 * 提示词体系移植自商汤开源 SenseNova-Skills（MIT 协议）：
 * - sn-infographic：布局/风格体系 + 基础提示词模板（87 布局 / 66 风格中精选常用项）
 * - sn-image-resume：固定三段式作品集简历布局规则
 * 图像生成复用 draw.js 的商汤管线；结果由 index.js 落盘入库进绘图历史。
 */

// —— 信息图：精选布局（移植自 sn-infographic/references/layouts，中文化描述） ——
const INFOGRAPHIC_LAYOUTS = [
  { id: 'bento-grid', name: '便当格', desc: '大小不一的模块格子拼合，主信息占大格，适合多主题总览', guidelines: 'Grid of rectangular cells with mixed sizes (1x1, 2x1, 1x2, 2x2); hero cell for the main point; supporting cells around it; clear cell boundaries; icons per cell; main title at top; minimal text, maximum visual.' },
  { id: 'linear-progression', name: '线性流程', desc: '从上到下或从左到右的步骤推进，适合流程与教程', guidelines: 'Sequential steps arranged along a clear directional path with numbered markers; each step is a self-contained module with icon, short label and brief text; arrows or connecting lines between steps; strong start and end markers.' },
  { id: 'hub-spoke', name: '中心辐射', desc: '中心主题向四周辐射关联要点，适合关系梳理', guidelines: 'Central hub holds the main concept; spokes radiate outward to 4-8 satellite nodes; each node is a rounded card with icon and short label; connecting lines or curves from hub to nodes; balanced radial distribution.' },
  { id: 'dashboard', name: '数据看板', desc: '指标卡片 + 图表组合，适合数据与指标呈现', guidelines: 'KPI metric cards in a top row with large numbers; charts (bar, line, donut) in the middle zone; each data point visually distinct with bold numbers in callout badges; clean grid alignment; data-first hierarchy.' },
  { id: 'binary-comparison', name: '左右对比', desc: '两栏对照布局，适合方案对比与优劣分析', guidelines: 'Two distinct vertical columns separated by a central divider; left and right sides use contrasting color treatments; parallel items aligned at the same height for easy comparison; vs badge or center axis marker; balanced visual weight.' },
  { id: 'circular-flow', name: '循环环', desc: '首尾相接的环形流程，适合周期与闭环说明', guidelines: 'Nodes arranged on a circular path with directional arrows showing the loop; each node is a compact card with icon and label; center area holds the cycle title; even angular spacing; clear rotation direction.' },
  { id: 'hierarchical-layers', name: '层级分层', desc: '自上而下的金字塔式层级，适合架构与组织结构', guidelines: 'Stacked horizontal layers from top to bottom showing hierarchy; top layer narrowest (highest level), bottom widest; each layer a labeled band with icon and short description; connecting lines between parent and child levels.' },
  { id: 'timeline', name: '时间轴', desc: '沿时间线排布事件节点，适合历史与里程碑', guidelines: 'A dominant horizontal or vertical timeline axis; event nodes anchored on the axis with date badges; alternating content placement above/below the axis; milestone markers emphasized; chronological flow clearly readable.' },
  { id: 'four-quadrant-grid', name: '四象限', desc: '两轴划分的四象限矩阵，适合分类定位分析', guidelines: 'Two crossing axes dividing the canvas into four quadrants; axis labels at both ends; each quadrant a distinct color zone with its own title and items; center cross point marked; items placed by their position on both axes.' },
  { id: 'iceberg', name: '冰山模型', desc: '水面上下分层揭示表象与本质，适合问题剖析', guidelines: 'Waterline divides the canvas; small tip above water representing visible symptoms; large submerged mass below representing root causes; layered depth zones with labels; dramatic scale contrast between tip and base.' },
  { id: 'story-mountain', name: '故事山', desc: '起伏的叙事曲线推进情节，适合历程与故事', guidelines: 'A rising and falling path like a mountain silhouette across the canvas; key story beats placed along the path at peaks and valleys; each beat has icon, label and short text; climax at the summit; resolution at the end.' },
  { id: 'single-focal-point', name: '单焦点', desc: '一个主视觉聚焦核心概念，配少量辅助说明', guidelines: 'One dominant central illustration or icon occupying 50%+ of canvas; main title above or integrated with the focal visual; 2-4 compact supporting notes around the edges; generous whitespace; strong visual impact.' },
];

// —— 信息图：精选风格（移植自 sn-infographic/references/styles，中文化描述） ——
const INFOGRAPHIC_STYLES = [
  { id: 'flat-design', name: '扁平化', desc: '纯色块 + 简洁几何图形，现代通用', guidelines: 'No shadows or gradients; solid color blocks and simple shapes; 3-5 color limited palette; clean sans-serif bold headings; flat illustrations replacing photography; high contrast between text and background.' },
  { id: 'corporate-memphis', name: '商务孟菲斯', desc: '扁平人物插画 + 柔和大色块，专业友好', guidelines: 'Flat character illustrations with exaggerated proportions; soft rounded shapes; warm professional palette (coral, teal, mustard, navy); friendly geometric decorations; generous spacing.' },
  { id: 'chinese-guochao', name: '国潮', desc: '传统纹样 + 现代配色，中国文化主题', guidelines: 'Traditional Chinese motifs (clouds, waves, lattice) reinterpreted in modern flat style; bold red/gold/ink palette; seal stamp accents; symmetric decorative borders; contemporary typography with classical flavor.' },
  { id: 'data-visualization', name: '数据可视化', desc: '图表优先的理性风格，适合数据报告', guidelines: 'Chart-first design language; grid-based precision; restrained palette with one accent color; monospaced numerals; axis lines and tick marks as decorative elements; editorial data journalism feel.' },
  { id: 'paper-collage', name: '纸艺拼贴', desc: '剪纸质感 + 手作温度，亲切轻松', guidelines: 'Layered paper cutout shapes with subtle drop shadows; torn paper edges; craft texture; playful overlapping elements; warm friendly palette; hand-cut label tags.' },
  { id: 'neon-futurism', name: '霓虹未来', desc: '深底 + 霓虹光效，科技感强', guidelines: 'Dark background with glowing neon accents (cyan, magenta, purple); luminous outlines and gradients; futuristic grid or particle backdrop; high-tech HUD elements; sharp geometric forms.' },
  { id: 'swiss-style', name: '瑞士风格', desc: '严谨网格 + 大字排版，克制专业', guidelines: 'Strict modular grid; large bold sans-serif typography as primary visual element; generous whitespace; limited palette (black, white, one red accent); objective photography-free layout; diagonal axis dynamics.' },
  { id: 'chalkboard', name: '黑板手写', desc: '黑板底 + 粉笔笔触，教学氛围', guidelines: 'Dark chalkboard texture background; hand-drawn chalk lines and doodles; white and pastel chalk colors; sketchy arrows and underlines; classroom annotation feel; casual friendly typography.' },
  { id: 'art-deco', name: '装饰艺术', desc: '几何对称 + 复古奢华线条', guidelines: 'Symmetrical geometric ornamentation; gold and deep emerald/navy palette; sunburst and fan motifs; elegant thin line frames; luxurious 1920s Gatsby aesthetic; stepped forms.' },
  { id: 'crayon-hand-drawn', name: '蜡笔手绘', desc: '童趣蜡笔质感，活泼可爱', guidelines: 'Waxy crayon texture strokes; childlike doodle icons; bright primary colors; imperfect hand-drawn borders; playful tilting elements; sketchy outlines.' },
  { id: 'minimalism', name: '极简', desc: '大量留白 + 少量元素，高级克制', guidelines: 'Extreme whitespace; one accent color on neutral background; thin line icons; tiny refined typography; each element earns its place; calm and premium feel.' },
  { id: 'isometric', name: '等距视角', desc: '2.5D 等距场景，空间感强', guidelines: 'Isometric 30-degree projection; 3D-looking flat objects without perspective distortion; consistent scale across elements; soft ambient shadows; pastel or tech palette; scene-like composition.' },
];

// 信息图可用比例（对齐绘图工作台预设尺寸）
const INFOGRAPHIC_SIZES = ['auto', '2048x2048', '2720x1536', '1536x2720', '1664x2496', '2496x1664'];

// 简历图可用比例（模板为纵向长图，默认 9:16 意向 → 1536x2720）
const RESUME_SIZES = ['auto', '1536x2720', '1664x2496', '2048x2048'];

/**
 * 组装信息图生成提示词（移植 sn-infographic base-prompt 模板）。
 * content：用户提供的主题内容文本；layoutId/styleId：布局与风格 ID。
 */
function buildInfographicPrompt(content, layoutId, styleId) {
  const layout = INFOGRAPHIC_LAYOUTS.find((l) => l.id === layoutId) || INFOGRAPHIC_LAYOUTS[0];
  const style = INFOGRAPHIC_STYLES.find((s) => s.id === styleId) || INFOGRAPHIC_STYLES[0];
  return [
    'Create a professional infographic following these specifications:',
    '## Image Specifications',
    '- Type: Infographic',
    `- Layout: ${layout.name} (${layout.id})`,
    `- Style: ${style.name} (${style.id})`,
    '- Language: Chinese (Simplified)',
    '## Core Principles',
    '- Follow the layout structure precisely for information architecture',
    '- Apply style aesthetics consistently throughout',
    '- Keep information concise, highlight keywords and core concepts',
    '- Use ample whitespace for visual clarity',
    '- Maintain clear visual hierarchy with distinct priority levels',
    '## Visual Elements',
    '- At least one primary illustration or icon set corresponding to the topic',
    '- Distinct visual markers for each section (shapes, borders, color blocks, or badges)',
    '## Text Requirements',
    '- Main titles prominent and readable; all text in Chinese',
    '- Key concepts visually emphasized (bold, larger size, or color contrast)',
    '- Hard data (numbers, dates, proper nouns) in visually distinct formats: bold, callout boxes, or data badges',
    '## Layout Guidelines',
    layout.guidelines,
    '## Style Guidelines',
    style.guidelines,
    '## Color Palette',
    'Use descriptive color names only. Never use hex codes.',
    '---',
    'Generate the infographic based on the content below:',
    content,
  ].join('\n');
}

/**
 * 组装简历图生成提示词（移植 sn-image-resume 固定三段式布局规则）。
 * resumeContent：用户简历文本；style：可选风格描述（自由文本）。
 */
function buildResumePrompt(resumeContent, style) {
  const styleLine = style && style.trim()
    ? `Requested visual style: ${style.trim()}. Translate this style onto the fixed layout skeleton (change the skin, not the structure).`
    : 'No explicit style instruction. Infer an appropriate professional visual style from the resume content.';
  return [
    'Create a tall designed portfolio-resume image (a designed personal portfolio-resume landing page, not a generic infographic).',
    'All text content in the image must be in the same language as the resume content below (Chinese if the resume is in Chinese).',
    styleLine,
    '## Fixed Layout Skeleton (must follow, top to bottom, three stacked zones)',
    '### Zone 1: Cover / Hero (about 30-38% of page height)',
    '- A very large bold display title (the person name / identity), split across two lines if needed, upper-left to center-left',
    '- A short subtitle or role label near the title',
    '- A large portrait or figure cutout on the right side, backed by rounded rectangular or circular color blocks',
    '- A few small decorative doodles, icons, or quote marks lightly scattered around the title area',
    '- The title must be the most visually dominant element; the portrait the second',
    '### Zone 2: About / Resume Information (about 34-42% of page height)',
    '- Left side: a medium portrait block in a rounded frame, with a dedicated contact card box beneath it (contact items as a clean vertical list with small icons)',
    '- Right side: greeting heading + profile summary paragraph, then a labeled education block, a grouped skills/tools module, and a structured work/project experience block',
    '- Break information into clearly designed submodules (labeled paragraphs, aligned info rows, compact timeline entries, icon-backed tool lists, grouped tags); avoid dense walls of text',
    '### Zone 3: Table of Contents / Category Navigation (about 20-28% of page height)',
    '- A large centered section heading, optionally with faint oversized ghost text behind it',
    '- A row of 3-5 large rounded category cards, each with one icon, one short label, and optional small subtitle; unified visual style, like bold navigation buttons',
    '### Dividers',
    '- Separate the three zones with elegant dividers: thin lines, circular arrow markers, section labels, or spacing bands; zones must not visually collapse',
    '## Rules',
    '- Text rarely floats on blank background: attach important content to visible panels, strips, cards, or backing surfaces',
    '- Balanced left-right weight, strong focal hierarchy, clean alignment, pleasing negative space',
    '- Map the actual resume content into the modules: name/identity into hero, contacts into the left contact card, summary into intro block, education/experience/skills into their submodules, projects/specialties into the bottom category cards',
    '- Do not invent resume details the user did not provide; only reorganize, condense, and visually map provided information',
    '- Typography hierarchy: main title > name/role > section headings > module labels > body text; keep text large and legible',
    '---',
    'Resume content:',
    resumeContent,
  ].join('\n');
}

module.exports = {
  INFOGRAPHIC_LAYOUTS,
  INFOGRAPHIC_STYLES,
  INFOGRAPHIC_SIZES,
  RESUME_SIZES,
  buildInfographicPrompt,
  buildResumePrompt,
};
