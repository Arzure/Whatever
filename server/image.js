/**
 * 文生图封装（SenseNova /images/generations 接口，原生 fetch 零依赖）。
 * 注意：图像接口地址独立于 LLM 接口（默认 https://token.sensenova.cn/v1），
 * 通过 IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL 配置；未配置 IMAGE_MODEL 时
 * 优雅降级：返回 null，前端不显示插画、不影响游戏。
 * 成本控制：结果缓存（同一存档同一主题只生成一次），存内存 Map。
 */
const REQUEST_TIMEOUT_MS = 90000; // 生图比文字慢，放宽到 90s

// 缓存：key = 存档id:主题，value = base64 图片（避免重复扣费）
const imageCache = new Map();
const CACHE_MAX = 60; // 最多缓存 60 张，超出淘汰最旧

function imageConfig() {
  return {
    baseUrl: (process.env.IMAGE_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/+$/, ''),
    apiKey: process.env.IMAGE_API_KEY || process.env.LLM_API_KEY || '',
    model: process.env.IMAGE_MODEL || '', // 未配置则不启用插画
  };
}

function isImageEnabled() {
  return !!(process.env.IMAGE_MODEL && (process.env.IMAGE_API_KEY || process.env.LLM_API_KEY));
}

/**
 * 生成插画。返回 { b64 } 或 null（未启用/失败均返回 null，绝不抛错影响游戏）。
 * @param {string} cacheKey 缓存键（存档id:主题）
 * @param {string} prompt 生图提示词（调用方负责固定风格前缀）
 */
async function generateImage(cacheKey, prompt) {
  if (!isImageEnabled()) return null;
  if (imageCache.has(cacheKey)) return { b64: imageCache.get(cacheKey) };
  const cfg = imageConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
        watermark: false, // 显式传入：公测期免费去水印，避免默认值变更影响
        prompt_extend: true, // 提示词自动润色
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[image] 生图请求失败 (${res.status})：${text.slice(0, 200)}，跳过插画`);
      return null;
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.log('[image] 响应中无图片数据，跳过插画');
      return null;
    }
    // 写缓存（简单淘汰：超限时删最旧）
    if (imageCache.size >= CACHE_MAX) {
      const oldest = imageCache.keys().next().value;
      imageCache.delete(oldest);
    }
    imageCache.set(cacheKey, b64);
    return { b64 };
  } catch (err) {
    console.log(`[image] 生图异常：${err.message}，跳过插画`);
    return null; // 插画失败绝不影响游戏流程
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateImage, isImageEnabled };
