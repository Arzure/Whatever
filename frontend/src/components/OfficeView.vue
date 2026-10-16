<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '../api';
import { marked } from 'marked';

// 办公助手（阶段 1）：信息图 + 简历图。提示词体系由服务端组装，前端只负责选项与展示
const tab = ref('infographic'); // infographic | resume | chart
const config = ref({ layouts: [], styles: [], infographicSizes: [], resumeSizes: [], defaultModel: '' });
const content = ref(''); // 信息图内容 / 简历文本
const layoutId = ref('');
const styleId = ref('');
const resumeStyle = ref(''); // 简历图：自由文本风格描述（可选）
const size = ref('auto');
const model = ref('');
const busy = ref(false);
const error = ref('');
const result = ref(null); // 生成结果：改用历史记录的签名 URL 显示（首次加载即建立浏览器缓存）
const history = ref([]); // 办公助手生成历史（仅信息图/简历图）
const preview = ref(''); // 灯箱预览的图片 URL（空串关闭）
// 图表解读：上传的图片 Data URL + 可选提问 + 解读结果
const chartImage = ref('');
const chartQuestion = ref('');
const chartResult = ref('');
const chartBusy = ref(false);
// Excel 分析：上传的文件名 + Base64 + 可选提问 + 分析结果
const excelName = ref('');
const excelB64 = ref('');
const excelQuestion = ref('');
const excelResult = ref('');
const excelMeta = ref(null); // { totalRows, sheets: [...] }
const excelBusy = ref(false);

// Excel 分析：选择文件 → 转 Base64
function onExcelFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    error.value = '仅支持 xlsx/xls/csv 文件';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = '文件过大（超过 10MB）';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    // FileReader 结果去掉 Data URL 前缀，只留 Base64
    const b64 = String(reader.result).split(',')[1] || '';
    excelName.value = file.name;
    excelB64.value = b64;
    excelResult.value = '';
    excelMeta.value = null;
    error.value = '';
  };
  reader.readAsDataURL(file);
}

// Excel 分析：调用对话模型分析
async function analyzeExcel() {
  if (excelBusy.value) return;
  if (!excelB64.value) {
    error.value = '请先上传 Excel/CSV 文件';
    return;
  }
  excelBusy.value = true;
  error.value = '';
  excelResult.value = '';
  excelMeta.value = null;
  try {
    const r = await api.officeExcel({ file: excelB64.value, question: excelQuestion.value.trim() });
    excelResult.value = r.text || '';
    excelMeta.value = r.meta || null;
  } catch (e) {
    error.value = e.message;
  } finally {
    excelBusy.value = false;
  }
}

// 图表解读：选择文件 → 转 Base64 Data URL 预览
function onChartFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
    error.value = '仅支持 png/jpeg/webp 图片';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    error.value = '图片过大（超过 8MB）';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    chartImage.value = reader.result;
    chartResult.value = '';
    error.value = '';
  };
  reader.readAsDataURL(file);
}

// 图表解读：调用多模态模型解读
async function interpretChart() {
  if (chartBusy.value) return;
  if (!chartImage.value) {
    error.value = '请先上传图表图片';
    return;
  }
  chartBusy.value = true;
  error.value = '';
  chartResult.value = '';
  try {
    const r = await api.officeChart({ image: chartImage.value, question: chartQuestion.value.trim() });
    chartResult.value = r.text || '';
  } catch (e) {
    error.value = e.message;
  } finally {
    chartBusy.value = false;
  }
}

// 历史剩余时限：按生成时间动态计算（每分钟刷新时钟），与绘图工作台逻辑一致
const nowTick = ref(Date.now());
const TTL_MS = 24 * 60 * 60 * 1000;
let tickTimer = null;
onMounted(() => {
  tickTimer = setInterval(() => { nowTick.value = Date.now(); }, 60 * 1000);
});
onUnmounted(() => { if (tickTimer) clearInterval(tickTimer); });
function formatExpiry(ts) {
  const remain = TTL_MS - (nowTick.value - ts);
  if (remain <= 0) return '已过期';
  const totalMin = Math.floor(remain / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}小时${m}分后过期` : `${m}分后过期`;
}

// 文件大小格式化：字节 → KB/MB
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

// 下载历史图片：先选格式（PNG/JPEG/WebP），画布转换后保存——无论原图什么格式都按所选格式导出
const downloadMenu = ref(null); // 待下载项（非空时显示格式选择浮层）
function downloadHistory(r) {
  downloadMenu.value = r;
}
async function downloadAs(fmt) {
  const r = downloadMenu.value;
  downloadMenu.value = null;
  if (!r) return;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = r.url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (fmt === 'jpeg') { // JPEG 无透明通道：先铺白底避免透明区域变黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    const url = canvas.toDataURL(`image/${fmt}`, 0.92);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.mode}-${r.id}.${fmt}`;
    a.click();
  } catch (e) {
    error.value = '下载失败：图片转换出错';
  }
}

async function loadHistory() {
  try {
    const h = await api.drawHistory();
    history.value = (h.rows || []).filter((r) => r.mode === 'infographic' || r.mode === 'resume');
  } catch { /* 历史加载失败不阻塞主流程 */ }
  try {
    const p = await api.drawPrompts('office'); // 办公来源的提示词历史（与绘图工作台隔离）
    promptHistory.value = (p.rows || []).slice(0, 10);
  } catch { /* 静默 */ }
}

// 历史画廊按当前标签过滤：信息图标签只看信息图，简历图标签只看简历图
const filteredHistory = computed(() => {
  if (tab.value === 'infographic') return history.value.filter((r) => r.mode === 'infographic');
  if (tab.value === 'resume') return history.value.filter((r) => r.mode === 'resume');
  return [];
});

// 分析结果 Markdown 渲染（图表解读 / Excel 分析的返回文本）
function renderMd(text) {
  if (!text) return '';
  return marked.parse(String(text));
}

// 提示词历史：点选填入输入框
const promptHistory = ref([]);
function usePrompt(p) {
  content.value = p.prompt;
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
  // 简历标签页：输入框为空时自动填入最佳实践示例——可直接生成体验效果，也可在示例上改成自己的内容
  if (t === 'resume' && !content.value.trim()) {
    content.value = RESUME_SAMPLE;
  }
}

// 简历最佳实践示例（实测验证过的格式：每行一个条目，短句经历）
const RESUME_SAMPLE = [
  '姓名：王芳',
  '职位：UI/UX 设计师',
  '教育：中国美术学院 视觉传达设计 2017-2021',
  '经历：腾讯 高级UI设计师 2021-2026',
  '经历：主导多个亿级用户产品的界面改版与设计系统搭建',
  '技能：Figma Sketch Principle 交互设计',
  '联系方式：wangfang@example.com',
].join('\n');

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
    await (tab.value === 'infographic' ? api.officeInfographic(params) : api.officeResume(params));
    await loadHistory(); // 生成成功后刷新历史画廊
    // 生成结果改用历史记录的签名 URL 显示：首次加载从服务器拉取并建立浏览器缓存，之后刷新直接命中缓存
    const latest = history.value[0];
    result.value = latest ? { url: latest.url, mode: latest.mode } : null;
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
        <button :class="{ on: tab === 'chart' }" @click="switchTab('chart')">🔍 图表解读</button>
        <button :class="{ on: tab === 'excel' }" @click="switchTab('excel')">📊 Excel 分析</button>
      </div>

      <div class="panel">
        <!-- 图表解读面板 -->
        <template v-if="tab === 'chart'">
          <label class="field-label">上传图表图片（png/jpeg/webp，8MB 内）</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" class="chart-file" @change="onChartFile" />
          <img v-if="chartImage" :src="chartImage" class="chart-preview" alt="图表预览" />
          <label class="field-label">想重点了解什么（可选）</label>
          <input v-model="chartQuestion" class="style-input" placeholder="示例：第三季度的下滑是什么原因？" maxlength="500" />
          <button class="generate" :disabled="chartBusy" @click="interpretChart">
            {{ chartBusy ? '解读中…（约需 10-30 秒）' : '开始解读' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
          <div v-if="chartResult" class="chart-result">
            <label class="field-label">解读结果</label>
            <div class="chart-text md" v-html="renderMd(chartResult)"></div>
          </div>
        </template>

        <!-- Excel 分析面板 -->
        <template v-else-if="tab === 'excel'">
          <label class="field-label">上传 Excel/CSV 文件（xlsx/xls/csv，10MB 内，限 5000 行）</label>
          <input type="file" accept=".xlsx,.xls,.csv" class="chart-file" @change="onExcelFile" />
          <p v-if="excelName" class="excel-name">已选择：{{ excelName }}</p>
          <label class="field-label">想重点分析什么（可选）</label>
          <input v-model="excelQuestion" class="style-input" placeholder="示例：哪个季度销售额最高？有什么异常？" maxlength="500" />
          <button class="generate" :disabled="excelBusy" @click="analyzeExcel">
            {{ excelBusy ? '分析中…（约需 20-60 秒）' : '开始分析' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
          <div v-if="excelMeta" class="chart-result">
            <label class="field-label">数据概览</label>
            <p class="chart-text">共 {{ excelMeta.totalRows }} 行数据；{{ excelMeta.sheets.map((s) => s.name + '（' + s.rowCount + ' 行）').join('、') }}</p>
          </div>
          <div v-if="excelResult" class="chart-result">
            <label class="field-label">分析结果</label>
            <div class="chart-text md" v-html="renderMd(excelResult)"></div>
          </div>
        </template>

        <!-- 信息图 / 简历图面板 -->
        <template v-else>
        <!-- 提示词历史：点选填入（仅办公来源） -->
        <div v-if="promptHistory.length && tab !== 'chart'" class="prompt-tags">
          <button v-for="p in promptHistory" :key="p.id" class="prompt-tag" :title="p.prompt" @click="usePrompt(p)">{{ p.prompt.slice(0, 18) }}…</button>
        </div>
        <!-- 内容输入 -->
        <label class="field-label">{{ tab === 'infographic' ? '信息图内容（主题、要点、数据）' : '简历内容（姓名、经历、技能、联系方式等）' }}</label>
        <textarea
          v-model="content"
          class="content-input"
          rows="8"
          :placeholder="tab === 'infographic'
            ? '示例：\n主题：2026 年 AI 发展趋势\n要点：\n1. 多模态成为主流…\n2. Agent 能力快速进化…\n3. 端侧模型普及…'
            : '每行一个条目（姓名/职位/教育/经历/技能/联系方式），已预填示例可直接生成，改成自己的内容即可'"
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

        <!-- 模型选择 -->
        <label class="field-label">模型</label>
        <div class="option-grid">
          <button
            v-for="m in config.models"
            :key="m.id"
            class="option"
            :class="{ on: model === m.id }"
            :title="m.desc"
            @click="model = m.id"
          >{{ m.id === 'sensenova-u1.5-fast' ? '⚡ 加速版' : '✨ 质量版' }}</button>
        </div>
        <p v-if="config.models?.find((m) => m.id === model)" class="option-desc">{{ config.models.find((m) => m.id === model).desc }}</p>

        <button class="generate" :disabled="busy" @click="generate">
          {{ busy ? '生成中…（大图约需 10-60 秒）' : (tab === 'infographic' ? '生成信息图' : '生成简历图') }}
        </button>
        <p class="model-line">当前模型：{{ model }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        </template>
      </div>

      <!-- 生成结果：签名 URL 显示，首次加载即建立浏览器缓存 -->
      <div v-if="result && result.url" class="result">
        <label class="field-label">生成结果（已存入历史，24 小时保留）</label>
        <img class="result-img" :src="result.url" alt="生成结果" @click="preview = result.url" />
      </div>

      <!-- 办公助手生成历史：条目化显示，逻辑与绘图工作台画廊一致 -->
      <div v-if="filteredHistory.length" class="history">
        <label class="field-label">生成历史</label>
        <div v-for="r in filteredHistory" :key="r.id" class="history-item">
          <img :src="r.url" class="history-img" loading="lazy" :alt="r.prompt" @click="preview = r.url" title="点击预览大图" />
          <div class="history-meta">
            <span class="history-prompt" :title="r.prompt">{{ r.prompt }}</span>
            <span class="history-info">{{ r.mode === 'infographic' ? '信息图' : '简历图' }} · {{ r.model }} · {{ r.size }}<template v-if="r.actual"> · {{ r.actual }}</template><template v-if="r.bytes"> · {{ formatBytes(r.bytes) }}</template> · {{ formatExpiry(r.created_at) }}</span>
            <div class="history-actions">
              <button class="history-btn" @click="downloadHistory(r)">⬇ 下载</button>
              <button class="history-btn danger" @click="removeHistory(r.id)">🗑 删除</button>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="history-empty">尚无生成结果</p>
    </div>

    <!-- 灯箱预览：点击图片放大查看，点任意处关闭 -->
    <div v-if="preview" class="lightbox" @click="preview = ''">
      <img :src="preview" class="lightbox-img" alt="预览" />
    </div>

    <!-- 下载格式选择浮层：选格式后画布转换保存 -->
    <div v-if="downloadMenu" class="lightbox" @click.self="downloadMenu = null">
      <div class="fmt-box">
        <p class="fmt-title">选择下载格式</p>
        <div class="fmt-grid">
          <button class="fmt-btn" @click="downloadAs('png')">PNG<br /><small>无损 · 体积大</small></button>
          <button class="fmt-btn" @click="downloadAs('jpeg')">JPEG<br /><small>通用 · 体积小</small></button>
          <button class="fmt-btn" @click="downloadAs('webp')">WebP<br /><small>均衡 · 推荐</small></button>
        </div>
        <button class="fmt-cancel" @click="downloadMenu = null">取消</button>
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
/* 图表解读面板 */
.chart-file {
  width: 100%;
  box-sizing: border-box;
  font-size: 13px;
  color: var(--text-dim);
  padding: 8px;
  border: 1px dashed var(--border, #444);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.15);
}
.chart-preview {
  max-width: 100%;
  max-height: 320px;
  border-radius: 10px;
  border: 1px solid var(--border, #444);
  margin-top: 10px;
  display: block;
}
.chart-result {
  margin-top: 16px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border, #444);
  border-radius: 10px;
  padding: 12px 14px;
}
.chart-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text, #eee);
  white-space: pre-wrap;
  margin: 0;
}
/* Markdown 渲染结果：标题/列表/加粗等格式化显示 */
.chart-text.md {
  white-space: normal;
}
.chart-text.md :deep(h1),
.chart-text.md :deep(h2),
.chart-text.md :deep(h3) {
  font-size: 15px;
  margin: 14px 0 6px;
  color: var(--text, #eee);
}
.chart-text.md :deep(ul),
.chart-text.md :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.chart-text.md :deep(li) {
  margin: 3px 0;
}
.chart-text.md :deep(strong) {
  color: #7c6cf0;
}
.chart-text.md :deep(p) {
  margin: 6px 0;
}
/* 提示词历史标签 */
.prompt-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.prompt-tag {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, #444);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 11px;
  padding: 3px 10px;
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prompt-tag:hover {
  border-color: #7c6cf0;
  color: var(--text, #eee);
}
/* Excel 分析面板 */
.excel-name {
  font-size: 13px;
  color: var(--text, #eee);
  margin: 8px 0 0;
}
.history {
  margin-top: 22px;
}
.history-empty {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 40px 0;
}
.history-item {
  display: flex;
  gap: 12px;
  border: 1px solid var(--border, #444);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.2);
  margin-bottom: 12px;
}
.history-img {
  width: 140px;
  flex-shrink: 0;
  object-fit: cover;
  cursor: zoom-in;
}
.history-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
}
.history-prompt {
  font-size: 13px;
  color: var(--text, #eee);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.history-info {
  font-size: 12px;
  color: var(--text-dim);
}
.history-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}
.history-btn {
  background: none;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  color: var(--text, #eee);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}
.history-btn:hover {
  border-color: #7c6cf0;
}
.history-btn.danger {
  color: #ff7d7d;
}
.history-btn.danger:hover {
  border-color: #ff7d7d;
}
/* 手机端适配：头部紧凑化、历史条目纵向堆叠、结果区紧凑 */
@media (max-width: 480px) {
  .office-header {
    gap: 8px;
  }
  .office-header h2 {
    font-size: 17px;
    white-space: nowrap;
  }
  .office-header .hint {
    display: none; /* 副标题窄屏隐藏，避免单字换行 */
  }
  .back {
    padding: 5px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .tabs button {
    font-size: 12px;
    padding: 8px 2px;
    white-space: nowrap; /* 禁止换行：『Excel 分析』等标签文字在窄屏单字挂行不美观 */
  }
  .history-item {
    flex-direction: column; /* 历史条目纵向堆叠：缩略图在上信息在下 */
  }
  .history-img {
    width: 100%;
    max-height: 200px;
  }
  .chart-preview {
    max-height: 220px;
  }
}
.result-img {
  cursor: zoom-in;
}
/* 灯箱预览：全屏遮罩 + 图片自适应 */
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: zoom-out;
  padding: 20px;
}
.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
}
/* 下载格式选择浮层 */
.fmt-box {
  background: var(--panel, #1e1e24);
  border: 1px solid var(--border, #444);
  border-radius: 12px;
  padding: 18px;
  width: min(320px, 90vw);
}
.fmt-title {
  margin: 0 0 12px;
  text-align: center;
  font-size: 14px;
  color: var(--text, #eee);
}
.fmt-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.fmt-btn {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  color: var(--text, #eee);
  font-size: 13px;
  padding: 10px 4px;
  cursor: pointer;
  line-height: 1.5;
}
.fmt-btn small {
  color: var(--text-dim);
  font-size: 11px;
}
.fmt-btn:hover {
  border-color: #7c6cf0;
}
.fmt-cancel {
  width: 100%;
  margin-top: 10px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  padding: 6px;
}
.fmt-cancel:hover {
  color: var(--text, #eee);
}
</style>
