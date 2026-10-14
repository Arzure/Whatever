/**
 * 绘图玩法（生图工作台）：独立于文字冒险的生图代理。
 * 透传全部可配置参数到 SenseNova /images/generations 接口；
 * 复用 IMAGE_API_KEY / LLM_API_KEY 配置；未配置时返回 disabled。
 * 注意：绘图结果不入存档体系（轻量会话，前端自行管理历史）。
 */
const REQUEST_TIMEOUT_MS = 120000; // 多张图生成较慢

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

// 预设模型清单（官方文档禁止自动抓取，只保留实际验证过的型号；UI 支持自定义输入补充）
const PRESET_MODELS = [
  { id: 'sensenova-u1.5-fast', desc: 'U1.5 快速版（默认，速度快）' },
];

// 支持的尺寸（正方形/横版/竖版常见档位）
const PRESET_SIZES = ['512x512', '768x768', '1024x1024', '768x1344', '1344x768'];

/**
 * 生图：透传全部参数。返回 { b64s: [...] } 或 { disabled } / { error }
 * 参数校验：n 1-4；size 白名单；模型名格式校验（防注入）。
 */
async function generate(params) {
  const cfg = imageConfig();
  if (!isImageEnabled()) return { disabled: true };
  const model = String(params.model || cfg.model || '').trim();
  if (!model || !/^[A-Za-z0-9._-]+$/.test(model)) return { error: '无效的模型名' };
  const prompt = String(params.prompt || '').trim().slice(0, 2000);
  if (!prompt) return { error: '提示词不能为空' };
  const negativePrompt = String(params.negativePrompt || '').trim().slice(0, 1000);
  const n = Math.min(4, Math.max(1, Number(params.n) || 1));
  const size = PRESET_SIZES.includes(params.size) ? params.size : '1024x1024';
  const watermark = params.watermark === false ? false : true;
  const promptExtend = params.promptExtend === false ? false : true;
  const seed = Number.isFinite(Number(params.seed)) && params.seed !== '' && params.seed !== null ? Number(params.seed) : undefined;

  const body = {
    model,
    prompt,
    n,
    size,
    response_format: 'b64_json',
    watermark,
    prompt_extend: promptExtend,
  };
  if (negativePrompt) body.negative_prompt = negativePrompt;
  if (seed !== undefined) body.seed = seed;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `生图请求失败（${res.status}）：${text.slice(0, 200)}` };
    }
    const data = await res.json();
    const b64s = (data?.data || []).map((d) => d?.b64_json).filter(Boolean);
    if (!b64s.length) return { error: '响应中无图片数据' };
    return { b64s };
  } catch (err) {
    return { error: `生图异常：${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate, isImageEnabled, PRESET_MODELS, PRESET_SIZES };
