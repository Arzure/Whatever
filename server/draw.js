/**
 * 绘图玩法（生图工作台）：独立于文字冒险的生图代理。
 * 依据 SenseNova 官方文档实现两个接口：
 * 1. 文生图 POST /v1/images/generations（仅 prompt）；
 * 2. 图片编辑 POST /v1/images/edits（参考图 + 编辑提示词，图生图）。
 * 参数严格对齐官方：n 仅支持 1；size 为 2K/4K 建议档位或 auto；
 * output_format 支持 png/jpeg/webp；不支持 negative_prompt 与 seed（官方无此参数）。
 * 复用 IMAGE_API_KEY / LLM_API_KEY 配置；未配置时返回 disabled。
 */
const REQUEST_TIMEOUT_MS = 180000; // 2K/4K 大图生成较慢

function imageConfig() {
  return {
    baseUrl: (process.env.IMAGE_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/+$/, ''),
    apiKey: process.env.IMAGE_API_KEY || process.env.LLM_API_KEY || '',
    model: process.env.IMAGE_MODEL || '',
  };
}

function isImageEnabled() {
  return !!(process.env.IMAGE_API_KEY || process.env.LLM_API_KEY);
}

// 预设模型清单（官方文档确认的生图模型；desc 为介绍文案，前端在选中模型下方单独显示）
const PRESET_MODELS = [
  { id: 'sensenova-u1.5-fast', desc: '加速版：即时创作，高效修改，兼顾质量与速度' },
  { id: 'sensenova-u1.5-lite', desc: '生成与编辑一体：强化参考图创作与视觉表现，构图光影细节更佳' },
];

// 官方建议分辨率（2K/4K 档位）+ auto
const PRESET_SIZES = [
  'auto', '2048x2048', '2720x1536', '1536x2720', '1664x2496', '2496x1664', '4096x4096',
];

// 输出格式（官方支持）
const OUTPUT_FORMATS = ['png', 'jpeg', 'webp'];

/** 公共参数组装与校验 */
function buildBody(params, cfg) {
  const model = String(params.model || cfg.model || '').trim();
  if (!model || !/^[A-Za-z0-9._-]+$/.test(model)) return { error: '无效的模型名' };
  const prompt = String(params.prompt || '').trim().slice(0, 2000);
  if (!prompt) return { error: '提示词不能为空' };
  // 尺寸：预设档位，或自定义 WIDTHxHEIGHT（512-4096、32 的倍数、比例 ≤3:1，官方规则）
  let size = 'auto';
  if (params.size && params.size !== 'auto') {
    const m = String(params.size).match(/^(\d+)x(\d+)$/);
    if (m) {
      const w = Number(m[1]), h = Number(m[2]);
      const valid = w >= 512 && w <= 4096 && h >= 512 && h <= 4096
        && w % 32 === 0 && h % 32 === 0 && w / h <= 3 && h / w <= 3;
      if (!valid) return { error: '尺寸无效：宽高需为 512-4096 的 32 倍数，比例不超过 3:1' };
      size = `${w}x${h}`;
    } else if (PRESET_SIZES.includes(params.size)) {
      size = params.size;
    } else {
      return { error: '尺寸格式无效' };
    }
  }
  const watermark = params.watermark === false ? false : true; // 官方建议显式传入
  const promptExtend = params.promptExtend === false ? false : true;
  const outputFormat = OUTPUT_FORMATS.includes(params.outputFormat) ? params.outputFormat : 'png';
  return {
    body: {
      model,
      prompt,
      n: 1, // 官方限制：生成数量仅支持 1
      size,
      watermark,
      prompt_extend: promptExtend,
      output_format: outputFormat,
      response_format: 'b64_json', // 前端直接展示，不用 24h 失效的临时 url
    },
  };
}

/** 调用接口并解析响应 */
async function callApi(path, body) {
  const cfg = imageConfig();
  if (!isImageEnabled()) return { disabled: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `请求失败（${res.status}）：${text.slice(0, 200)}` };
    }
    const data = await res.json();
    const b64s = (data?.data || []).map((d) => d?.b64_json).filter(Boolean);
    if (!b64s.length) return { error: '响应中无图片数据' };
    return { b64s };
  } catch (err) {
    return { error: `请求异常：${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 文生图：仅文本 prompt */
async function generate(params) {
  const r = buildBody(params, imageConfig());
  if (r.error) return r;
  return callApi('/images/generations', r.body);
}

/**
 * 图片编辑（图生图）：参考图 + 编辑提示词。
 * images：Data URL 数组（data:image/png;base64,...），第 1 张为主编辑图，至多 5 张。
 */
async function edit(params) {
  const r = buildBody(params, imageConfig());
  if (r.error) return r;
  const images = Array.isArray(params.images) ? params.images : [];
  if (!images.length) return { error: '图片编辑至少需要上传一张参考图' };
  if (images.length > 5) return { error: '参考图至多支持 5 张' };
  for (const img of images) {
    if (typeof img !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(img)) {
      return { error: '图片格式无效（需 Data URL：png/jpeg/webp）' };
    }
    if (img.length > 12 * 1024 * 1024) return { error: '单张图片过大（Base64 超过 12MB）' };
  }
  r.body.images = images.map((image_url) => ({ image_url }));
  return callApi('/images/edits', r.body);
}

module.exports = { generate, edit, isImageEnabled, PRESET_MODELS, PRESET_SIZES, OUTPUT_FORMATS };
