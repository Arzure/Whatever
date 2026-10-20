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
 * 组装简历图生成提示词（平衡版：文字准确 + 版面设计）。
 * 实测迭代记录：
 * - 28 行英文布局规则 → 文字乱码（超出图像模型指令遵循容量）
 * - 7 行精简指令 → 文字准确但版面平庸（失去设计指导）
 * - 平衡版：中等篇幅中文版面指导 + 逐字渲染硬约束，实测验证平衡点
 * resumeContent：用户简历文本；style：可选风格描述（自由文本）。
 */
function buildResumePrompt(resumeContent, style) {
  const styleLine = style && style.trim() ? `整体风格：${style.trim()}。` : '整体风格：现代专业设计，配色克制和谐。';
  return [
    '一张竖版设计感简历海报，像专业设计师排版的作品集页面。',
    styleLine,
    '版面：顶部封面区放超大加粗姓名与职位标签、右侧人物头像插画、大色块背景；中部左侧圆角联系卡片，右侧教育/经历/技能三个模块（醒目小标题、经历用时间轴、技能用胶囊标签）；底部一排 3-4 个带图标的圆角分类卡片。文字放在色块面板上，留白充足，层级分明。',
    '图片中的所有文字必须严格使用下面给出的内容，逐字一致，不得改写、不得虚构、不得添加原文没有的词：',
    '---',
    resumeContent,
    '---',
    '再次强调：上图中的全部文字必须与上述内容逐字一致。版面设计可以自由发挥，但每一个字都必须来自上述内容，写不清楚的字宁可放大字号也要写对。',
  ].join('\n');
}

/**
 * 组装报告网页化提示词（移植 sn-md-to-html-report 核心资产，MIT 协议）。
 * 原技能是本地 Agent 多轮工作流（先写 plan.md 再写 HTML），Web 单次调用压缩为一次生成：
 * 保留核心原则（事实保真 / 主题契合 / 设计契约 / 审查角度），省略多轮 plan 交互。
 * content：用户提供的 Markdown 报告文本；styleHint：可选风格倾向（自由文本）。
 */
function buildReportPrompt(content, styleHint) {
  const styleLine = styleHint && styleHint.trim() ? `风格倾向：${styleHint.trim()}。` : '';
  // 提示词必须保持超精简（实测教训，重要）：sensenova-6.8-flash-lite 的指令遵循容量很小，
  // 指令+内容总长较大时直接返回空内容——实测 626 字指令稳定失败、348 字指令稳定成功；
  // 与开发记录中图像模型『28 行英文规则文字乱码』同源（模型容量问题，非提示词写法问题）。
  // 故只保留一句话级的核心要求，设计细节交给模型自由发挥。
  return [
    '把下面的报告做成一个美观、有设计感的自包含单文件 HTML 页面：保留原文全部事实与数字，不发明内容；按主题气质设计配色与版面，避免通用模板；内联 CSS 不引外部资源，移动端无横向滚动。',
    styleLine,
    '只输出 HTML 文档。',
    '---',
    content,
  ].join('\n');
}

/**
 * 风格模仿（移植 sn-image-imitate 三阶段管线，MIT 协议，Web 简化为两步）：
 * 原管线：图像标注（长描述+布局蓝图 JSON）→ 描述改写（锁定风格布局）→ 生图 → 布局审查重试。
 * Web 简化：VLM 提取参考图风格描述 → 与新内容组装生成提示词 → 复用绘图管线。
 * 省略布局蓝图 JSON 与审查重试（模型容量与耗时限制），保留『风格锁定 + 内容替换』核心思想。
 * 提示词保持超精简（同 buildReportPrompt 的实测教训：指令过长模型返回空内容）。
 */
function buildImitateAnnotatePrompt() {
  return '详细描述这张参考图的视觉风格，用于指导生成同风格新图：配色（主色调与氛围）、排版与字体气质、版面布局（区块数量与排布方式）、图形语言（扁平/立体/插画/照片质感）、装饰元素与整体情绪。用中文，200 字以内，只输出风格描述。';
}

/** 图转提示词：VLM 从参考图反向解析出可直接用于绘图的提示词（四段结构化） */
function buildExtractPromptPrompt() {
  return '分析这张图片，反向推导出能生成类似图像的绘图提示词。按以下四段输出，每段一行，格式为『段名：内容』：\n主体内容：画面里有什么（人物/物体/场景/动作/文字元素）\n艺术风格：插画/写实/水彩/赛博朋克/扁平化/3D 渲染等具体风格词\n构图视角：特写/全景/俯视/仰视/对称构图/黄金分割等\n色调氛围：主色调/饱和度/光线条件/情绪氛围\n要求：用绘图模型友好的具体词汇（如『吉卜力风格，柔光，低饱和』），不要文学化描述，不要犹豫推敲，直接给结论。只输出这四行，不要其他内容。';
}

/** PPT 简化版（移植 sn-ppt-story 大纲方法论 + sn-ppt-standard 渲染思路，MIT 协议）：
 * Web 单次调用三步：LLM 生成大纲（宽松字段格式）→ 逐页配图（复用绘图管线）→ 组装自包含 HTML 幻灯片。
 * 提示词保持超精简（同 buildReportPrompt 实测教训：sensenova-6.8-flash-lite 指令容量小，过长直接返回空内容）。 */
function buildPptOutlinePrompt(topic, pageCount) {
  return [
    `为主题『${topic}』设计一份 ${pageCount} 页的演示文稿大纲。每页按以下三行输出：`,
    '标题：本页标题',
    '要点：3-5 条要点，用分号分隔',
    '配图：一句话描述适合本页的插图',
    '先想清楚叙事主线（如背景→矛盾→方案→结论的推进），不要机械罗列目录。只输出大纲，不要其他内容。',
  ].join('\n');
}

/** 宽松解析 PPT 大纲：按『标题：/要点：/配图：』字段行分组，兼容单行英文标签格式（吸取乱码检测教训：不强制 JSON） */
function parsePptOutline(text, maxPages) {
  const slides = [];
  let cur = null;
  // 占位过滤：模型复述提示词格式说明、思考兜底碎语或纯符号行（如『...』）时——按特征识别并丢弃
  const isPlaceholder = (s) => {
    const t = String(s.title || '');
    const p = String(s.points || '');
    return /^本页标题\s*(\(Title.*\))?$/i.test(t.trim())
      || /^3-5\s*条要点/i.test(p.trim())
      || /^Key\s*Points/i.test(p.trim())
      || /I should stick to the exact format/i.test(t + ' ' + p)
      || !/[\u4e00-\u9fffa-zA-Z0-9]/.test(t); // 标题无任何文字（纯符号/省略号）视为占位
  };
  const push = (s) => { if (s && s.title && !isPlaceholder(s)) slides.push(s); };
  for (const line of String(text || '').split('\n')) {
    // 单行英文标签格式：『标题. Points: 要点. Image: 配图』——自动拆分为三字段
    const one = line.match(/^(.+?)\s*\.\s*Points?\s*[:：]\s*(.+?)(?:\s*\.\s*Image\s*[:：]\s*(.+))?$/i);
    if (one) {
      push(cur);
      cur = { title: one[1].trim(), points: (one[2] || '').trim(), image: (one[3] || '').trim() };
      continue;
    }
    const t = line.match(/标题[：:]\s*(.+)/);
    const p = line.match(/要点[：:]\s*(.+)/);
    const i = line.match(/配图[：:]\s*(.+)/);
    if (t) { push(cur); cur = { title: t[1].trim(), points: '', image: '' }; continue; }
    if (cur && p) { cur.points = p[1].trim(); continue; }
    if (cur && i) { cur.image = i[1].trim(); continue; }
  }
  push(cur);
  // 按标题去重：模型把大纲重复输出两遍时，保留字段更完整的那个
  const byTitle = new Map();
  for (const s of slides) {
    const key = s.title.replace(/\s+/g, '');
    const old = byTitle.get(key);
    if (!old || (s.points.length + s.image.length) > (old.points.length + old.image.length)) byTitle.set(key, s);
  }
  let out = [...byTitle.values()];
  // 页数约束：超过请求页数时保留字段最完整的前 N 页（维持原顺序）
  if (maxPages && out.length > maxPages) {
    out = out
      .map((s, idx) => ({ s, idx, score: s.points.length + s.image.length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPages)
      .sort((a, b) => a.idx - b.idx)
      .map((x) => x.s);
  }
  return out;
}

/** 组装自包含 HTML 幻灯片：键盘/按钮翻页，1280×720 自适应缩放，无外部依赖 */
function buildPptHtml(slides, images, topic) {
  const pages = slides.map((s, i) => {
    const img = images && images[i] ? `<img src="${images[i]}" class="slide-img" alt="">` : '';
    const pts = String(s.points || '').split(/[；;]/).map((x) => x.trim()).filter(Boolean)
      .map((x) => `<li>${x}</li>`).join('');
    return [
      `<section class="slide${i === 0 ? ' current' : ''}">`,
      `  <div class="slide-body">`,
      `  <h2>${s.title}</h2>`,
      img,
      pts ? `  <ul>${pts}</ul>` : '',
      '  </div>',
      '</section>',
    ].filter(Boolean).join('\n');
  }).join('\n');
  return [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${topic}</title>`,
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { background: #111; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }',
    '.stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }',
    '.deck { position: relative; width: 1280px; height: 720px; transform-origin: center; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.5); }',
    '.slide { display: none; position: absolute; inset: 0; padding: 56px 76px; }',
    '.slide.current { display: block; }',
    '.slide-body { transform-origin: top center; }',
    '.slide h2 { font-size: 42px; color: #1a1a2e; margin-bottom: 26px; border-left: 8px solid #4f6ef7; padding-left: 20px; }',
    '.slide-img { display: block; margin: 0 auto 22px; max-height: 430px; max-width: 100%; object-fit: contain; border-radius: 8px; }',
    '.slide ul { list-style: none; }',
    '.slide li { font-size: 25px; color: #333; line-height: 1.7; padding: 9px 0 9px 34px; position: relative; }',
    '.slide li::before { content: "▸"; position: absolute; left: 8px; color: #4f6ef7; }',
    '.nav { position: absolute; right: 20px; bottom: 14px; display: flex; gap: 12px; align-items: center; color: #999; font-size: 13px; z-index: 10; }',
    '.nav button { background: rgba(0,0,0,.08); color: #333; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; cursor: pointer; }',
    '.nav button:hover { background: rgba(0,0,0,.18); }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="stage"><div class="deck" id="deck">',
    pages,
    '<div class="nav">',
    '<button onclick="go(-1)">‹ 上一页</button>',
    '<span id="pageNo"></span>',
    '<button onclick="go(1)">下一页 ›</button>',
    '</div>',
    '</div></div>',
    '<script>',
    'const slides = document.querySelectorAll(".slide");',
    'let cur = 0;',
    'function show() { slides.forEach((s, i) => s.classList.toggle("current", i === cur)); document.getElementById("pageNo").textContent = (cur + 1) + " / " + slides.length; fitSlide(); }',
    'function fitSlide() { const s = slides[cur]; if (!s) return; const body = s.querySelector(".slide-body"); if (!body) return; body.style.transform = "none"; const avail = s.clientHeight - 112; const need = body.scrollHeight; if (need > avail) { const k = avail / need; body.style.transform = "scale(" + k + ")"; body.style.width = (100 / k) + "%"; body.style.marginLeft = "auto"; body.style.marginRight = "auto"; } else { body.style.width = ""; body.style.marginLeft = ""; body.style.marginRight = ""; } }',
    'function go(d) { cur = Math.min(Math.max(cur + d, 0), slides.length - 1); show(); }',
    'function fit() { const s = Math.min(innerWidth / 1320, innerHeight / 780); document.getElementById("deck").style.transform = "scale(" + s + ")"; }',
    'addEventListener("keydown", (e) => { if (["ArrowRight", "PageDown", " "].includes(e.key)) go(1); if (["ArrowLeft", "PageUp"].includes(e.key)) go(-1); });',
    'addEventListener("resize", fit);',
    'fit(); show();',
    'addEventListener("load", fitSlide);',
    '</' + 'script>',
    '</body>',
    '</html>',
  ].join('\n');
}

function buildImitatePrompt(styleDesc, targetContent) {
  return [
    '按以下视觉风格生成一张新图，风格与版面布局尽量与参考图保持一致：',
    styleDesc,
    '---',
    '新图的内容：',
    targetContent,
  ].join('\n');
}

// —— 报告结构模板（移植 sn-research-report，按读者认知任务选择模板） ——
const REPORT_STRUCTURES = [
  { id: 'panorama', name: '全景叙述', desc: '行业研究 / 可行性研究 / 趋势综述——建立完整心智地图', outline: '摘要（3-5 句含关键结论与核心数据）→ 背景与现状（界定范围、当前格局）→ 核心维度逐章展开（每维度自成小节）→ 综合分析（跨维度关联与洞察，不是各维度摘要）→ 结论与展望（基于证据，标注确定性程度）' },
  { id: 'comparison', name: '对比选型', desc: '竞品分析 / 技术选型 / 消费决策——多选项中做出有据决策', outline: '摘要与推荐（直接给结论+核心理由一句话）→ 评估背景（需求场景、约束、维度定义及权重）→ 选项概览（各自定位）→ 对比矩阵（表格：行=维度，列=选项）→ 逐维度分析（矩阵承载不了的定性分析）→ 综合建议（按场景差异化）→ 风险与局限' },
  { id: 'investigation', name: '实体调查', desc: '尽职调查 / 投资研究 / 背景调查——全面了解某对象形成判断', outline: '执行摘要（重大发现+关键风险+综合建议，可独立阅读）→ 分维度审查（业务/财务/法律/团队等按需选取）→ 重大发现汇总（红旗事项逐条列出，标注严重程度）→ 建议（明确行动依据）' },
  { id: 'timeline', name: '时序追踪', desc: '热点事件 / 危机追踪 / 政策变化——还原事件全貌与走向', outline: '摘要（事件一句话定性+当前状态）→ 事件时间线（表格：时间/事件/关键行动方）→ 各方立场（主要利益相关方分列不混叙）→ 影响分析（已发生影响分类列出，标注程度）→ 后续走向（待观察节点与不同情景）' },
  { id: 'academic', name: '学术综述', desc: '文献梳理——每条结论指向具体文献，争议点呈现各方代表', outline: '摘要 → 引言（背景、范围、结构）→ 研究脉络（按时间线或流派梳理）→ 方法论对比 → 核心发现综合（共识与争议）→ 研究空白与展望 → 结论 → 参考文献' },
];

/**
 * 组装报告写作提示词（移植 sn-research-report 模板体系）。
 * topic：研究主题；structureId：结构模板 ID；requirements：用户补充要求。
 * 注意保持精简（模型指令容量限制，实测教训）。
 */
function buildReportWritePrompt(topic, structureId, requirements) {
  const s = REPORT_STRUCTURES.find((x) => x.id === structureId) || REPORT_STRUCTURES[0];
  const reqLine = requirements && requirements.trim() ? `补充要求：${requirements.trim()}。` : '';
  return [
    `围绕主题撰写一份结构完整的中文报告，采用「${s.name}」结构：${s.outline}。`,
    reqLine,
    '要求：观点有依据，区分事实与判断；不确定的内容明确标注，不虚构数据与来源；条理清晰，用 Markdown 格式输出。',
    '主题：',
    topic,
  ].join('\n');
}

/**
 * 信息图乱码自动检测与修正（实测验证的方案）。
 * 原理：生图模型渲染中文小字是概率性缺陷；检测环节用对话模型的多模态能力
 * （与图表解读同管线）找出乱码并推断正确文字，修正环节用图片编辑能力
 * 按精确清单替换（任务从『创作』变『抄写』，模型做得到）。
 * 实测：15 处乱码的清单一次修正全部成功，布局配色保持原样。
 */

/** 检测提示词：找出乱码并推断正确文字（自然语言格式——实测稳定；强制 JSON 格式会诱发空内容，教训同报告网页化） */
function buildGarbleDetectPrompt() {
  return '仔细看这张信息图中的所有文字，找出乱码（错字/不成词的字）。直接输出清单，每处一行，格式：『乱码原文 → 正确文字（位置）』。不要犹豫、不要反复推敲，凭第一判断直接给结论。如果所有文字都清晰正确，只回答『没有乱码』。';
}

/** 修正提示词：按精确清单逐处替换，其余保持原样 */
function buildGarbleFixPrompt(items) {
  const lines = items.map((it, i) => `${i + 1}. ${it.pos}的『${it.bad}』改为『${it.fix}』`);
  return [
    '只修正以下乱码文字，把每处乱码替换为对应正确文字，其余布局、配色、图标、正常文字全部保持原样不变：',
    ...lines,
    '每个字都必须清晰正确，逐字重写上述文字。',
  ].join('\n');
}

/**
 * 解析检测返回的乱码清单（自然语言格式，宽松正则提取）。
 * 模型实际返回形如：『1. 最上方模块："AI驺设计"，乱码"驺"，正确应为"AI产品设计"』
 * 逐行提取：含『正确应为/应为/改成』的行，取行内引号内容为乱码原文，取『应为』后的引号内容为正确文字。
 */
function parseGarbleList(text) {
  const raw = String(text || '');
  // 『没有乱码』短路仅对短文本（正常正文结论）生效：思考兜底内容开头必然复述提示词
  // （『如果所有文字清晰正确，只回答没有乱码』），长文本据此短路会误杀全部有效信息（实测多次解析 0 处的元凶）
  if (!raw || (raw.length < 500 && /没有乱码|无乱码|全部清晰|都清晰|均清晰/.test(raw.slice(0, 200)))) return [];
  const items = [];
  // 字段行格式：『1. 乱码原文：XXX』『位置：XXX』『推断正确文字：XXX』三行一组（模型第三种返回格式）
  let cur = null;
  for (const line of raw.split('\n')) {
    const badF = line.match(/乱码原文[：:]\s*(.+)/);
    const posF = line.match(/位置[：:]\s*(.+)/);
    const fixF = line.match(/(?:推断)?正确文字[：:]\s*(.+)/);
    if (badF) {
      if (cur && cur.bad && cur.fix && cur.bad !== cur.fix) items.push(cur);
      cur = { bad: badF[1].trim().slice(0, 20), pos: '', fix: '' };
      continue;
    }
    if (cur && posF) { cur.pos = posF[1].trim().slice(0, 20); continue; }
    if (cur && fixF) { cur.fix = fixF[1].trim().slice(0, 20); continue; }
  }
  if (cur && cur.bad && cur.fix && cur.bad !== cur.fix) items.push(cur);
  if (items.length) return items; // 字段格式解析成功即返回，不再走下面的行解析
  for (const line of raw.split('\n')) {
    // 新提示词格式：『乱码原文 → 正确文字（位置）』（引导模型直接输出简洁清单）
    const arrowM = line.match(/([^\s→（()]{1,20})\s*→\s*([^（()\s]{1,20})(?:[（(]([^）)]{0,20})[）)])?/);
    if (arrowM && arrowM[1] !== arrowM[2] && !/乱码原文|正确文字|输出清单|直接输出/.test(arrowM[1]) && !/乱码原文|正确文字|输出清单|直接输出/.test(arrowM[2])) {
      items.push({ bad: arrowM[1].trim(), pos: (arrowM[3] || '').trim().slice(0, 20), fix: arrowM[2].trim() });
      continue;
    }
    // Markdown 表格行：『| 乱码原文 | 所在位置 | 正确文字 |』（模型有时返回表格格式）
    const tableM = line.match(/^\s*\|(.+)\|\s*$/);
    if (tableM) {
      const cells = tableM[1].split('|').map(s => s.trim()).filter(Boolean);
      // 跳过表头行与 ---- 分隔行
      if (cells.length >= 3 && !/^-+$/.test(cells[0]) && !/乱码原文|所在位置|正确文字/.test(line)) {
        const [bad, pos, fixRaw] = cells;
        // fix 列可能混入解释文字（如『AI，结合上下文，此处应为“AI产品设计”』）：优先提取『应为“XXX”』引号内容，否则截断到首个逗号/句号
        let fix = fixRaw;
        const qm = fixRaw.match(/应为[：“"]([^”"]+)[”"]/) || fixRaw.match(/是[：“"]([^”"]+)[”"]/);
        if (qm) fix = qm[1];
        else fix = fixRaw.split(/[，,。；;（(]/)[0];
        if (bad && fix && bad !== fix) {
          items.push({ bad: bad.slice(0, 20), pos: pos.slice(0, 20), fix: fix.slice(0, 20) });
        }
      }
      continue;
    }
    if (!/应为|改成|更正为|正确是/.test(line)) continue;
    // 正确文字：『应为/改成』后的引号内容（兼容 「」『』“”‘’ 与裸文本到标点）
    const fixM = line.match(/(?:应为|改成|更正为|正确是)[：「"『“‘\s]*([^」"』“‘”。；;，,]{1,20})/);
    // 乱码原文：行内第一个引号内容（兼容中文弯引号“”）
    const badM = line.match(/[：「"『“]([^」"』“”]{1,20})[」"』”]/);
    if (fixM && badM && badM[1] !== fixM[1].trim()) {
      items.push({ bad: badM[1].trim(), pos: line.split(/[：:]/)[0].replace(/^\d+[.、\s]*/, '').slice(0, 20), fix: fixM[1].trim() });
    }
  }
  // 思考内容兜底解析（reasoningFallback 文本噪声大，仅在上述解析均为空时启用）：
  // 提取『X→Y』『“X”是“Y”的乱码』『X是Y的乱码』等零散表述，去重后返回
  if (!items.length) {
    const seen = new Set();
    const seenBad = new Set(); // 同一乱码原文只取第一个推断（思考中模型常对同一处反复猜多种可能）
    const pushPair = (bad, fix) => {
      bad = String(bad).replace(/^(?:然后|接着|还有|以及|哦)+/, '').trim();
      fix = String(fix).replace(/^(?:然后|接着|还有|以及|哦)+/, '').trim();
      // 过滤噪声：含疑问/语气标点的匹配通常是思考过程中的犹豫片段，不可靠
      if (/[？?！!哦对]/.test(bad) || /[？?！!哦对]/.test(fix)) return;
      // 过滤提示词复述：思考内容开头会复述『格式为『乱码原文 → 正确文字』』等提示词本身
      if (/乱码原文|正确文字|输出清单|直接输出/.test(bad) || /乱码原文|正确文字|输出清单|直接输出/.test(fix)) return;
      if (!bad || !fix || bad === fix || bad.length > 20 || fix.length > 20) return;
      const key = bad + '|' + fix;
      if (seen.has(key)) return;
      if (seenBad.has(bad)) return; // 同一 bad 的后续猜测丢弃，只保留第一个推断
      seen.add(key);
      seenBad.add(bad);
      items.push({ bad, pos: '', fix });
    };
    for (const m of raw.matchAll(/“([^”]{1,20})”是“([^”]{1,20})”的乱码/g)) pushPair(m[1], m[2]);
    // 『“乱码” -> “X” 应该是 “Y”』『“乱码”应该是“Y”』等引号表述（思考内容常见）
    for (const m of raw.matchAll(/“([^”]{1,20})”(?:\s*->\s*“[^”]*”)?\s*应该是\s*“([^”]{1,20})”/g)) pushPair(m[1], m[2]);
    for (const m of raw.matchAll(/“([^”]{1,20})”\s*->\s*“([^”]{1,20})”/g)) pushPair(m[1], m[2]);
    for (const m of raw.matchAll(/([\u4e00-\u9fa5A-Za-z0-9\/%\-]{1,20})是([\u4e00-\u9fa5A-Za-z0-9\/%\-]{1,20})的乱码/g)) pushPair(m[1], m[2]);
    for (const m of raw.matchAll(/([^\s“”，。；：]{1,20})\s*→\s*([^\s“”，。；：]{1,20})/g)) pushPair(m[1], m[2]);
  }
  return items;
}

module.exports = {
  INFOGRAPHIC_LAYOUTS,
  INFOGRAPHIC_STYLES,
  INFOGRAPHIC_SIZES,
  RESUME_SIZES,
  REPORT_STRUCTURES,
  buildInfographicPrompt,
  buildResumePrompt,
  buildReportPrompt,
  buildImitateAnnotatePrompt,
  buildExtractPromptPrompt,
  buildPptOutlinePrompt,
  parsePptOutline,
  buildPptHtml,
  buildImitatePrompt,
  buildReportWritePrompt,
  buildGarbleDetectPrompt,
  buildGarbleFixPrompt,
  parseGarbleList,
};
