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
  // 超时可传参（毫秒）：默认 60 秒；办公分析等长输出场景可按需放宽
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);

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
        max_tokens: opts.maxTokens ?? 4096,
        // 官方推荐参数（sensenova 系列）：
        // - reasoning_effort: 'none' 关闭思考模式（思考内容与输出共享 max_tokens 配额，开启会导致输出被截断/空内容）
        //   办公分析等场景可传 opts.reasoningEffort: 'high' 开启思考（注意：开启思考时 max_tokens 需相应放大）
        // - response_format 结构化输出，强制模型返回合法 JSON（注意：thinking 字段不受支持，会返回 400）
        //   传 opts.responseFormat: null 可关闭结构化输出（自由文本，办公分析等场景）；默认开启保持既有调用方行为不变
        reasoning_effort: opts.reasoningEffort ?? 'none',
        ...(opts.responseFormat === null ? {} : { response_format: opts.responseFormat ?? { type: 'json_object' } }),
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
  if (!content) {
    // 兜底：模型偶发陷入思考耗尽配额导致正文为空，但 reasoning 字段存有思考内容；
    // 检测等场景可传 opts.reasoningFallback: true，用思考内容兜底（宽松解析仍可提取有效信息）
    if (opts.reasoningFallback && data?.choices?.[0]?.message?.reasoning) {
      return String(data.choices[0].message.reasoning);
    }
    throw new Error('LLM 返回了空内容');
  }
  return content;
}

/**
 * 流式调用 /chat/completions（stream: true）。
 * onDelta(content 增量) / onReasoning(思考增量) 逐段回调；返回完整正文。
 * 不可用（接口不支持流式等）时抛错，由调用方回退非流式。
 */
async function chatStream(messages, opts = {}, onDelta, onReasoning) {
  const cfg = llmConfig();
  if (!cfg.apiKey) {
    throw new Error('未配置 LLM_API_KEY，请在项目根目录的 .env 文件中填写 API Key');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);
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
        max_tokens: opts.maxTokens ?? 4096,
        stream: true,
        reasoning_effort: opts.reasoningEffort ?? 'none',
        ...(opts.responseFormat === null ? {} : { response_format: opts.responseFormat ?? { type: 'json_object' } }),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`无法连接 LLM 服务（${cfg.baseUrl}）：${err.message}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    throw new Error(`LLM 请求失败 (${res.status})：${text.slice(0, 300)}`);
  }
  // SSE 解析：按行读 data: {...}，提取增量内容与思考
  let full = '';
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // 末行可能不完整，留待下轮
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let j;
        try { j = JSON.parse(payload); } catch { continue; }
        const delta = j?.choices?.[0]?.delta;
        if (!delta) continue;
        const rc = delta.reasoning_content ?? delta.reasoning;
        if (rc && onReasoning) onReasoning(String(rc));
        const c = delta.content;
        if (c) {
          full += c;
          if (onDelta) onDelta(String(c));
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!full) throw new Error('LLM 返回了空内容');
  return full;
}

module.exports = { chat, chatStream, isConfigured, llmConfig };
