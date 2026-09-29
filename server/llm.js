const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const REQUEST_TIMEOUT_MS = 60000;

function llmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  };
}

function isConfigured() {
  return !!process.env.LLM_API_KEY;
}

/**
 * 调用 OpenAI 兼容的 /chat/completions 接口。
 * 使用 Node 20 内置 fetch，不依赖第三方 SDK。
 */
async function chat(messages, opts = {}) {
  const cfg = llmConfig();
  if (!cfg.apiKey) {
    throw new Error('未配置 LLM_API_KEY，请在项目根目录的 .env 文件中填写 API Key');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature ?? 0.8,
        max_tokens: opts.maxTokens ?? 2048,
        // 官方推荐参数（sensenova 系列）：
        // - reasoning_effort: 'none' 关闭思考模式（思考内容与输出共享 max_tokens 配额，开启会导致输出被截断/空内容）
        // - response_format 开启结构化输出，强制模型返回合法 JSON（注意：thinking 字段不受支持，会返回 400）
        reasoning_effort: opts.reasoningEffort ?? 'none',
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`无法连接 LLM 服务（${cfg.baseUrl}）：${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM 请求失败 (${res.status})：${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('LLM 返回了空内容');
  return content;
}

module.exports = { chat, isConfigured, llmConfig };
