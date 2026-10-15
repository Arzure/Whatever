<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

// 办公助手（阶段 1）：信息图 + 简历图。提示词体系由服务端组装，前端只负责选项与展示
const tab = ref('infographic'); // infographic | resume
const config = ref({ layouts: [], styles: [], infographicSizes: [], resumeSizes: [], defaultModel: '' });
const content = ref(''); // 信息图内容 / 简历文本
const layoutId = ref('');
const styleId = ref('');
const resumeStyle = ref(''); // 简历图：自由文本风格描述（可选）
const size = ref('auto');
const model = ref('');
const busy = ref(false);
const error = ref('');
const result = ref(null); // { b64s: [dataUrl...] }
const history = ref([]); // 办公助手生成历史（仅信息图/简历图）

async function loadHistory() {
  try {
    const h = await api.drawHistory();
    history.value = (h.rows || []).filter((r) => r.mode === 'infographic' || r.mode === 'resume');
  } catch { /* 历史加载失败不阻塞主流程 */ }
}

async function removeHistory(id) {
  try {
    await api.drawHistoryDelete(id);
    history.value = history.value.filter((r) => r.id !== id);
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(async () => {
  try {
    const c = await api.officeConfig();
    config.value = c;
    model.value = c.defaultModel || 'sensenova-u1.5-fast';
    if (c.layouts?.length) layoutId.value = c.layouts[0].id;
    if (c.styles?.length) styleId.value = c.styles[0].id;
  } catch (e) {
    error.value = e.message;
  }
  loadHistory();
});

function switchTab(t) {
  tab.value = t;
  error.value = '';
  result.value = null;
  size.value = 'auto';
}

async function generate() {
  if (busy.value) return;
  if (!content.value.trim()) {
    error.value = tab.value === 'infographic' ? '请填写信息图内容' : '请填写简历内容';
    return;
  }
  busy.value = true;
  error.value = '';
  result.value = null;
  try {
    const params = tab.value === 'infographic'
      ? { content: content.value.trim(), layout: layoutId.value, style: styleId.value, size: size.value, model: model.value }
      : { content: content.value.trim(), style: resumeStyle.value.trim(), size: size.value, model: model.value };
    result.value = await (tab.value === 'infographic' ? api.officeInfographic(params) : api.officeResume(params));
    await loadHistory(); // 生成成功后刷新历史画廊
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="office">
    <header class="office-header">
      <button class="back" @click="$emit('back')">‹ 返回首页</button>
      <h2>📊 办公助手</h2>
      <span class="hint">信息图 · 简历图 · 生成结果自动进入绘图历史</span>
    </header>

    <div class="office-body">
      <!-- 标签切换 -->
      <div class="tabs">
        <button :class="{ on: tab === 'infographic' }" @click="switchTab('infographic')">📈 信息图</button>
        <button :class="{ on: tab === 'resume' }" @click="switchTab('resume')">📄 简历图</button>
      </div>

      <div class="panel">
        <!-- 内容输入 -->
        <label class="field-label">{{ tab === 'infographic' ? '信息图内容（主题、要点、数据）' : '简历内容（姓名、经历、技能、联系方式等）' }}</label>
        <textarea
          v-model="content"
          class="content-input"
          rows="8"
          :placeholder="tab === 'infographic'
            ? '示例：\n主题：2026 年 AI 发展趋势\n要点：\n1. 多模态成为主流…\n2. Agent 能力快速进化…\n3. 端侧模型普及…'
            : '示例：\n姓名：张三\n职位：前端工程师\n教育：XX大学 计算机科学\n经历：A公司 高级前端（2022-2026）…\n技能：Vue / TypeScript / Node.js\n联系方式：zhangsan@example.com'"
          :maxlength="4000"
        ></textarea>
        <div class="char-count">{{ content.length }} / 4000</div>

        <!-- 信息图：布局与风格选择 -->
        <template v-if="tab === 'infographic'">
          <label class="field-label">布局</label>
          <div class="option-grid">
            <button
              v-for="l in config.layouts"
              :key="l.id"
              class="option"
              :class="{ on: layoutId === l.id }"
              :title="l.desc"
              @click="layoutId = l.id"
            >{{ l.name }}</button>
          </div>
          <p v-if="config.layouts.find((l) => l.id === layoutId)" class="option-desc">{{ config.layouts.find((l) => l.id === layoutId).desc }}</p>

          <label class="field-label">风格</label>
          <div class="option-grid">
            <button
              v-for="s in config.styles"
              :key="s.id"
              class="option"
              :class="{ on: styleId === s.id }"
              :title="s.desc"
              @click="styleId = s.id"
            >{{ s.name }}</button>
          </div>
          <p v-if="config.styles.find((s) => s.id === styleId)" class="option-desc">{{ config.styles.find((s) => s.id === styleId).desc }}</p>
        </template>

        <!-- 简历图：自由风格描述 -->
        <template v-else>
          <label class="field-label">视觉风格（可选，留空自动匹配专业风格）</label>
          <input v-model="resumeStyle" class="style-input" placeholder="示例：科技感蓝紫配色 / 温暖插画风 / 极简黑白" maxlength="100" />
        </template>

        <!-- 尺寸选择 -->
        <label class="field-label">尺寸</label>
        <div class="option-grid">
          <button
            v-for="s in (tab === 'infographic' ? config.infographicSizes : config.resumeSizes)"
            :key="s"
            class="option"
            :class="{ on: size === s }"
            @click="size = s"
          >{{ s === 'auto' ? '自动' : s }}</button>
        </div>

        <button class="generate" :disabled="busy" @click="generate">
          {{ busy ? '生成中…（大图约需 10-60 秒）' : (tab === 'infographic' ? '生成信息图' : '生成简历图') }}
        </button>
        <p class="model-line">当前模型：{{ model }}</p>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <!-- 生成结果 -->
      <div v-if="result && result.b64s && result.b64s.length" class="result">
        <label class="field-label">生成结果（已存入历史，24 小时保留）</label>
        <img
          v-for="(b64, i) in result.b64s"
          :key="i"
          class="result-img"
          :src="`data:image/png;base64,${b64}`"
          alt="生成结果"
        />
      </div>

      <!-- 办公助手生成历史：仅显示信息图/简历图，就地查看与删除 -->
      <div v-if="history.length" class="history">
        <label class="field-label">生成历史（{{ history.length }} 张，24 小时保留）</label>
        <div class="history-grid">
          <div v-for="r in history" :key="r.id" class="history-item">
            <img :src="r.url" class="history-img" loading="lazy" :alt="r.mode === 'infographic' ? '信息图' : '简历图'" />
            <div class="history-meta">
              <span class="history-mode">{{ r.mode === 'infographic' ? '📈 信息图' : '📄 简历图' }}</span>
              <span class="history-model" :title="r.model">{{ r.model }}</span>
              <button class="history-del" @click="removeHistory(r.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.office {
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 16px 60px;
}
.office-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.office-header h2 {
  margin: 0;
  font-size: 20px;
}
.office-header .hint {
  color: var(--text-dim);
  font-size: 12px;
}
.back {
  background: none;
  border: 1px solid var(--border, #444);
  color: var(--text, #eee);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.back:hover {
  opacity: 0.8;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.tabs button {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border, #444);
  background: transparent;
  color: var(--text, #eee);
  font-size: 14px;
  cursor: pointer;
}
.tabs button.on {
  border-color: #7c6cf0;
  background: rgba(124, 108, 240, 0.15);
  font-weight: bold;
}
.panel {
  background: var(--panel, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  padding: 18px;
}
.field-label {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin: 14px 0 8px;
}
.field-label:first-child {
  margin-top: 0;
}
.content-input,
.style-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, #444);
  border-radius: 10px;
  color: var(--text, #eee);
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
}
.content-input:focus,
.style-input:focus {
  outline: none;
  border-color: #7c6cf0;
}
.char-count {
  text-align: right;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 4px;
}
.option-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.option {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border, #444);
  background: transparent;
  color: var(--text, #eee);
  font-size: 13px;
  cursor: pointer;
}
.option.on {
  border-color: #7c6cf0;
  background: rgba(124, 108, 240, 0.18);
  font-weight: bold;
}
.option-desc {
  font-size: 12px;
  color: var(--text-dim);
  margin: 8px 0 0;
}
.generate {
  width: 100%;
  margin-top: 20px;
  padding: 12px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #7c6cf0, #5a8bf0);
  color: #fff;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
}
.generate:disabled {
  opacity: 0.55;
  cursor: wait;
}
.error {
  color: #ff7d7d;
  font-size: 13px;
  margin: 12px 0 0;
  text-align: center;
}
.result {
  margin-top: 18px;
}
.result-img {
  width: 100%;
  border-radius: 12px;
  margin-top: 10px;
  display: block;
}
.model-line {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  margin: 10px 0 0;
}
.history {
  margin-top: 22px;
}
.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.history-item {
  border: 1px solid var(--border, #444);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.2);
}
.history-img {
  width: 100%;
  display: block;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  cursor: zoom-in;
}
.history-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--text-dim);
}
.history-mode {
  flex-shrink: 0;
}
.history-model {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-del {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #ff7d7d;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.history-del:hover {
  text-decoration: underline;
}
</style>
