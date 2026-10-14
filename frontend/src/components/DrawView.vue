<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';

// —— 配置项（全部 UI 化） ——
const prompt = ref('');
const negativePrompt = ref('');
const model = ref('');
const customModel = ref(''); // 自定义模型输入（补充预设清单）
const size = ref('1024x1024');
const count = ref(1);
const seed = ref('');
const watermark = ref(false);
const promptExtend = ref(true);

const options = ref({ enabled: false, models: [], sizes: [], defaultModel: '' });
const generating = ref(false);
const error = ref('');
const history = ref([]); // 本次会话生成历史（前端管理，不入存档）

onMounted(async () => {
  try {
    const r = await api.drawOptions();
    options.value = r;
    model.value = r.defaultModel || (r.models[0] && r.models[0].id) || '';
    if (r.sizes && r.sizes.length) size.value = r.sizes[2] || r.sizes[0];
  } catch (e) { /* 静默 */ }
});

const effectiveModel = () => (model.value === '__custom__' ? customModel.value.trim() : model.value);

async function generate() {
  if (generating.value) return;
  const p = prompt.value.trim();
  if (!p) { error.value = '请输入提示词'; return; }
  const m = effectiveModel();
  if (!m) { error.value = '请选择或输入模型名'; return; }
  error.value = '';
  generating.value = true;
  try {
    const r = await api.drawGenerate({
      model: m,
      prompt: p,
      negativePrompt: negativePrompt.value.trim(),
      n: count.value,
      size: size.value,
      seed: seed.value === '' ? null : Number(seed.value),
      watermark: watermark.value,
      promptExtend: promptExtend.value,
    });
    if (r && r.b64s) {
      const ts = Date.now();
      for (const b64 of r.b64s) {
        history.value.unshift({ src: `data:image/png;base64,${b64}`, prompt: p, model: m, size: size.value, ts });
      }
    } else if (r && r.error) {
      error.value = r.error;
    }
  } catch (e) {
    error.value = e.message || '生成失败';
  }
  generating.value = false;
}

function download(item) {
  const a = document.createElement('a');
  a.href = item.src;
  a.download = `draw-${item.ts}.png`;
  a.click();
}
</script>

<template>
  <div class="draw">
    <div class="draw-layout">
      <!-- 左侧：参数面板 -->
      <aside class="draw-panel">
        <h2 class="draw-panel-title">🎨 生图工作台</h2>

        <div v-if="!options.enabled" class="draw-disabled">
          服务端未配置图像 API Key（IMAGE_API_KEY 或 LLM_API_KEY），绘图功能不可用。
        </div>

        <label class="field">
          <span class="field-label">模型</span>
          <select v-model="model" class="field-input">
            <option v-for="m in options.models" :key="m.id" :value="m.id">{{ m.desc }}</option>
            <option value="__custom__">自定义模型…</option>
          </select>
          <input v-if="model === '__custom__'" v-model="customModel" class="field-input" placeholder="输入模型 ID（如 sensenova-u1.5-fast）" />
        </label>

        <label class="field">
          <span class="field-label">尺寸</span>
          <select v-model="size" class="field-input">
            <option v-for="s in options.sizes" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">生成数量（1-4）</span>
          <input v-model.number="count" type="number" min="1" max="4" class="field-input" />
        </label>

        <label class="field">
          <span class="field-label">种子（留空随机）</span>
          <input v-model="seed" type="number" class="field-input" placeholder="随机" />
        </label>

        <label class="field row">
          <input v-model="watermark" type="checkbox" id="wm" />
          <span for="wm">添加水印</span>
        </label>
        <label class="field row">
          <input v-model="promptExtend" type="checkbox" id="pe" />
          <span for="pe">提示词自动润色</span>
        </label>
      </aside>

      <!-- 右侧：提示词与结果 -->
      <main class="draw-main">
        <div class="prompt-area">
          <textarea v-model="prompt" class="prompt-input" rows="3" placeholder="描述你想生成的画面…（支持中文）"></textarea>
          <textarea v-model="negativePrompt" class="prompt-input neg" rows="2" placeholder="负面提示词：不希望出现的元素（可选）"></textarea>
          <button class="btn primary generate-btn" :disabled="generating || !options.enabled" @click="generate">
            {{ generating ? '生成中…（多张约需 1-2 分钟）' : '✨ 开始生成' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <div v-if="history.length" class="gallery">
          <div v-for="(item, i) in history" :key="item.ts + '-' + i" class="gallery-item">
            <img :src="item.src" :alt="item.prompt" loading="lazy" @click="download(item)" title="点击下载" />
            <div class="gallery-meta">
              <span class="gallery-prompt" :title="item.prompt">{{ item.prompt }}</span>
              <span class="gallery-info">{{ item.model }} · {{ item.size }}</span>
            </div>
          </div>
        </div>
        <p v-else class="gallery-empty">尚无生成结果，输入提示词开始创作吧</p>
      </main>
    </div>
  </div>
</template>

<style scoped>
.draw {
  height: 100%;
  overflow-y: auto;
  background:
    radial-gradient(ellipse at 20% 10%, rgba(212, 161, 44, 0.08), transparent 50%),
    radial-gradient(ellipse at 80% 90%, rgba(60, 90, 160, 0.1), transparent 50%),
    var(--bg);
}
.draw-layout {
  display: flex;
  gap: 16px;
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  align-items: flex-start;
}
.draw-panel {
  width: 260px;
  flex-shrink: 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 16px;
  position: sticky;
  top: 20px;
}
.draw-panel-title {
  margin: 0 0 16px;
  font-size: 17px;
  color: var(--accent-2);
  text-align: center;
}
.draw-disabled {
  color: #f85149;
  font-size: 13px;
  line-height: 1.6;
  padding: 10px;
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: 8px;
  background: rgba(248, 81, 73, 0.06);
  margin-bottom: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.field.row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
}
.field-label {
  font-size: 12px;
  color: var(--text-dim);
}
.field-input {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
}
.field-input:focus {
  outline: none;
  border-color: var(--accent);
}
.draw-main {
  flex: 1;
  min-width: 0;
}
.prompt-area {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.prompt-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 10px 12px;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
}
.prompt-input:focus {
  outline: none;
  border-color: var(--accent);
}
.prompt-input.neg {
  margin-top: 10px;
  font-size: 13px;
}
.generate-btn {
  margin-top: 12px;
  width: 100%;
  padding: 10px;
  font-size: 15px;
}
.error {
  color: #f85149;
  font-size: 13px;
  margin: 10px 0 0;
}
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.gallery-item {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  animation: item-in 0.4s ease both;
}
@keyframes item-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.gallery-item img {
  width: 100%;
  display: block;
  cursor: zoom-in;
}
.gallery-meta {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.gallery-prompt {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gallery-info {
  font-size: 11px;
  color: var(--text-dim);
}
.gallery-empty {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 60px 0;
}
/* 手机端：参数面板收起为顶部区块 */
@media (max-width: 768px) {
  .draw-layout {
    flex-direction: column;
  }
  .draw-panel {
    width: 100%;
    position: static;
  }
}
</style>
