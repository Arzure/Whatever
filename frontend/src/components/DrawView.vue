<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';

// —— 模式：文生图 / 图片编辑（图生图） ——
const mode = ref('generate');

// —— 配置项（严格对齐官方接口参数） ——
const prompt = ref('');
const model = ref('');
const customModel = ref(''); // 自定义模型输入（补充预设清单）
const size = ref('auto');
const customW = ref(1024);
const customH = ref(1024); // 自定义尺寸（512-4096、32 的倍数）
const outputFormat = ref('png');
const watermark = ref(false);
const promptExtend = ref(true);

// 图片编辑：参考图（Data URL，第 1 张为主编辑图，至多 5 张）
const refImages = ref([]);

const options = ref({ enabled: false, models: [], sizes: [], outputFormats: [], defaultModel: '' });
const generating = ref(false);
const error = ref('');
const history = ref([]); // 本次会话生成历史（前端管理，不入存档）

onMounted(async () => {
  try {
    const r = await api.drawOptions();
    options.value = r;
    model.value = r.defaultModel || (r.models[0] && r.models[0].id) || '';
    if (r.sizes && r.sizes.length) size.value = r.sizes[0];
  } catch (e) { /* 静默 */ }
});

const effectiveModel = () => (model.value === '__custom__' ? customModel.value.trim() : model.value);
// 选中模型的介绍文案（下拉只显示纯型号名，介绍在下方单独一行）
const modelDesc = computed(() => {
  const m = options.value.models.find((x) => x.id === model.value);
  return m ? m.desc : '';
});

// 参考图上传：转 Data URL
function onPickImages(e) {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (refImages.value.length >= 5) { error.value = '参考图至多 5 张'; return; }
    if (f.size > 8 * 1024 * 1024) { error.value = `图片「${f.name}」超过 8MB`; continue; }
    const reader = new FileReader();
    reader.onload = () => { refImages.value.push(reader.result); };
    reader.readAsDataURL(f);
  }
  e.target.value = '';
}
function removeImage(i) {
  refImages.value.splice(i, 1);
}

async function run() {
  if (generating.value) return;
  const p = prompt.value.trim();
  if (!p) { error.value = mode.value === 'generate' ? '请输入提示词' : '请输入编辑指令'; return; }
  const m = effectiveModel();
  if (!m) { error.value = '请选择或输入模型名'; return; }
  if (mode.value === 'edit' && !refImages.value.length) { error.value = '图片编辑至少需要上传一张参考图'; return; }
  error.value = '';
  generating.value = true;
  try {
    const params = {
      model: m,
      prompt: p,
      size: size.value === '__custom__' ? `${customW.value}x${customH.value}` : size.value,
      outputFormat: outputFormat.value,
      watermark: watermark.value,
      promptExtend: promptExtend.value,
    };
    const r = mode.value === 'generate'
      ? await api.drawGenerate(params)
      : await api.drawEdit({ ...params, images: refImages.value });
    if (r && r.b64s) {
      const ts = Date.now();
      for (const b64 of r.b64s) {
        history.value.unshift({
          src: `data:image/${outputFormat.value};base64,${b64}`,
          prompt: p,
          model: m,
          size: size.value,
          mode: mode.value,
          ts,
        });
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
  a.download = `draw-${item.ts}.${outputFormat.value}`;
  a.click();
}

// 把历史图作为编辑参考图（连续创作）
function useAsRef(item) {
  if (refImages.value.length >= 5) { error.value = '参考图至多 5 张'; return; }
  refImages.value.push(item.src);
  mode.value = 'edit';
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

        <!-- 模式切换：文生图 / 图片编辑 -->
        <div class="mode-switch">
          <button :class="{ active: mode === 'generate' }" @click="mode = 'generate'">✨ 文生图</button>
          <button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">🖼️ 图片编辑</button>
        </div>

        <label class="field">
          <span class="field-label">模型</span>
          <select v-model="model" class="field-input">
            <option v-for="m in options.models" :key="m.id" :value="m.id">{{ m.id }}</option>
            <option value="__custom__">自定义模型…</option>
          </select>
          <input v-if="model === '__custom__'" v-model="customModel" class="field-input" placeholder="输入模型 ID" />
          <span v-if="modelDesc" class="model-desc">{{ modelDesc }}</span>
        </label>

        <label class="field">
          <span class="field-label">尺寸（auto 自动适配）</span>
          <select v-model="size" class="field-input">
            <option v-for="s in options.sizes" :key="s" :value="s">{{ s }}</option>
            <option value="__custom__">自定义…</option>
          </select>
          <div v-if="size === '__custom__'" class="size-custom">
            <input v-model.number="customW" type="number" min="512" max="4096" step="32" class="field-input" />
            <span class="size-x">×</span>
            <input v-model.number="customH" type="number" min="512" max="4096" step="32" class="field-input" />
          </div>
          <span v-if="size === '__custom__'" class="field-tip">宽高 512-4096、32 的倍数、比例 ≤3:1</span>
        </label>

        <label class="field">
          <span class="field-label">输出格式</span>
          <select v-model="outputFormat" class="field-input">
            <option v-for="f in options.outputFormats" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>

        <label class="field row">
          <input v-model="watermark" type="checkbox" id="wm" />
          <span for="wm">添加水印</span>
        </label>
        <label class="field row">
          <input v-model="promptExtend" type="checkbox" id="pe" />
          <span for="pe">提示词自动润色</span>
        </label>

        <p class="field-tip">官方限制：每次生成 1 张；尺寸为 32 倍数（512-4096）。</p>
      </aside>

      <!-- 右侧：提示词与结果 -->
      <main class="draw-main">
        <!-- 图片编辑：参考图上传区 -->
        <div v-if="mode === 'edit'" class="ref-area">
          <div class="ref-list">
            <div v-for="(img, i) in refImages" :key="i" class="ref-item">
              <img :src="img" alt="参考图" />
              <button class="ref-remove" @click="removeImage(i)">✕</button>
              <span v-if="i === 0" class="ref-main">主图</span>
            </div>
            <label class="ref-add" title="上传参考图（至多 5 张）">
              ＋
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="onPickImages" />
            </label>
          </div>
          <p class="ref-tip">第 1 张为主编辑图，其余为参考图（至多 5 张）；编辑指令尽量保留未指定修改的主体元素。</p>
        </div>

        <div class="prompt-area">
          <textarea
            v-model="prompt"
            class="prompt-input"
            rows="3"
            :placeholder="mode === 'generate' ? '描述你想生成的画面…（支持中文）' : '描述期望的最终画面，如：背景换成一望无际的冰川上…'"
          ></textarea>
          <button class="btn primary generate-btn" :disabled="generating || !options.enabled" @click="run">
            {{ generating ? '生成中…（2K/4K 大图可能需要 1-3 分钟）' : (mode === 'generate' ? '✨ 开始生成' : '🖼️ 开始编辑') }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <div v-if="history.length" class="gallery">
          <div v-for="(item, i) in history" :key="item.ts + '-' + i" class="gallery-item">
            <img :src="item.src" :alt="item.prompt" loading="lazy" @click="download(item)" title="点击下载" />
            <div class="gallery-meta">
              <span class="gallery-prompt" :title="item.prompt">{{ item.prompt }}</span>
              <span class="gallery-info">{{ item.mode === 'edit' ? '编辑' : '生成' }} · {{ item.model }} · {{ item.size }}</span>
              <button class="gallery-ref-btn" @click="useAsRef(item)" title="以此图继续编辑">以此图编辑</button>
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
  margin: 0 0 14px;
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
/* 模式切换 */
.mode-switch {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.mode-switch button {
  flex: 1;
  padding: 8px 0;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s;
}
.mode-switch button.active {
  border-color: var(--accent);
  color: var(--accent-2);
  background: rgba(212, 161, 44, 0.08);
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
.field-tip {
  font-size: 11px;
  color: var(--text-dim);
  margin: 4px 0 0;
  line-height: 1.5;
}
/* 选中模型的介绍文案 */
.model-desc {
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.5;
  margin-top: 2px;
}
/* 自定义尺寸输入 */
.size-custom {
  display: flex;
  align-items: center;
  gap: 6px;
}
.size-custom .field-input {
  flex: 1;
  min-width: 0;
}
.size-x {
  color: var(--text-dim);
  font-size: 13px;
}
.draw-main {
  flex: 1;
  min-width: 0;
}
/* 参考图上传区 */
.ref-area {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 14px;
}
.ref-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.ref-item {
  position: relative;
  width: 88px;
  height: 88px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.ref-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ref-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  line-height: 1;
}
.ref-main {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  font-size: 10px;
  text-align: center;
  background: rgba(212, 161, 44, 0.85);
  color: #1b1f24;
  padding: 1px 0;
}
.ref-add {
  width: 88px;
  height: 88px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--text-dim);
  cursor: pointer;
}
.ref-add:hover {
  border-color: var(--accent);
  color: var(--accent-2);
}
.ref-tip {
  font-size: 11px;
  color: var(--text-dim);
  margin: 10px 0 0;
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
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
  gap: 4px;
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
.gallery-ref-btn {
  align-self: flex-start;
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text-dim);
  cursor: pointer;
}
.gallery-ref-btn:hover {
  border-color: var(--accent);
  color: var(--accent-2);
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
