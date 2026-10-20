<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '../api';
import { marked } from 'marked';

// 办公助手（阶段 1）：信息图 + 简历图。提示词体系由服务端组装，前端只负责选项与展示
const tab = ref('report'); // report | resume | infographic | chart | excel | write
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
// 报告网页化：Markdown 内容 + 可选风格倾向 + 生成的 HTML（iframe 预览）
const reportContent = ref('');
const reportStyle = ref('');
const reportHtml = ref('');
const reportBusy = ref(false);
// 报告写作：主题 + 结构模板 + 补充要求 + 生成的 Markdown 报告
const writeTopic = ref('');
const writeStructure = ref('panorama');
const writeRequirements = ref('');
const writeResult = ref('');
const writeBusy = ref(false);
// 演示文稿（PPT 简化版）：主题 + 页数 + 配图开关 + 生成的 HTML 幻灯片
const pptTopic = ref('');
const pptPages = ref(6);
const pptWithImages = ref(true);
const pptHtml = ref('');
const pptBusy = ref(false);
const pptMeta = ref(null); // { pageCount, imageCount }
// 办公历史（报告网页化/演示文稿/报告写作，24 小时暂存）：点选恢复内容到预览区
const officeHistory = ref([]);
const officeRestoring = ref(''); // 正在恢复的条目 id（防重复点击）
async function loadOfficeHistory() {
  try {
    const h = await api.officeHistory();
    officeHistory.value = h.rows || [];
  } catch { /* 历史加载失败不阻塞主流程 */ }
}
// 按当前标签过滤：报告网页化/演示文稿/报告写作各自独立
const filteredOfficeHistory = computed(() => officeHistory.value.filter((r) => r.type === tab.value));
function officeTypeLabel(t) {
  return t === 'report' ? '报告网页化' : t === 'ppt' ? '演示文稿' : '报告写作';
}
// 点选恢复：拉取签名 URL 的文件内容，回填到对应标签的预览区
async function restoreOfficeItem(r) {
  if (officeRestoring.value) return;
  officeRestoring.value = r.id;
  error.value = '';
  try {
    const res = await fetch(r.url);
    if (!res.ok) throw new Error('文件已过期或不可用');
    const text = await res.text();
    if (r.type === 'write') {
      writeResult.value = text;
    } else if (r.type === 'ppt') {
      pptHtml.value = text;
      pptMeta.value = null;
    } else {
      reportHtml.value = text;
    }
  } catch (e) {
    error.value = '恢复失败：' + (e.message || '请重试');
    loadOfficeHistory(); // 可能已过期，刷新列表
  } finally {
    officeRestoring.value = '';
  }
}
async function runPpt() {
  if (pptBusy.value) return;
  const t = pptTopic.value.trim();
  if (!t) { error.value = '请填写演示主题'; return; }
  error.value = '';
  pptBusy.value = true;
  pptHtml.value = '';
  pptMeta.value = null;
  try {
    const r = await api.officePpt({ topic: t, pageCount: pptPages.value, withImages: pptWithImages.value });
    if (r && r.html) {
      pptHtml.value = r.html;
      pptMeta.value = { pageCount: r.pageCount, imageCount: r.imageCount };
      loadOfficeHistory(); // 生成成功后刷新办公历史
    } else {
      error.value = '生成失败，请重试';
    }
  } catch (e) {
    error.value = '生成失败：' + (e.message || '请重试');
  } finally {
    pptBusy.value = false;
  }
}
function downloadPpt() {
  if (!pptHtml.value) return;
  const blob = new Blob([pptHtml.value], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (pptTopic.value.trim() || 'presentation') + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
}
// 信息图生成进度：阶段文案按时间推进（生成→检测→修正），完成后按 garbleFixed 反馈
const genStage = ref(0); // 0 未开始 / 1 生成中 / 2 检测文字 / 3 修正乱码
const genStageTimer = ref(null);
const garbleNote = ref(''); // 信息图自动修正结果提示（非错误）
const GEN_STAGES = ['生成中…（大图约需 10-60 秒）', 'AI 正在检查文字是否清晰…（约 10-60 秒，偶尔需要重试）', '发现乱码，正在自动修正…（约 15-30 秒，可能进行两轮）'];
function startGenStages() {
  genStage.value = 1;
  genStageTimer.value = setInterval(() => {
    if (genStage.value < 3) genStage.value += 1;
  }, 25000); // 每 25 秒推进一个阶段（生成约 10-60s，检测约 10-20s，修正约 15-30s）
}
function stopGenStages() {
  if (genStageTimer.value) clearInterval(genStageTimer.value);
  genStageTimer.value = null;
  genStage.value = 0;
}

// 报告写作：调用对话模型按结构模板撰写报告
async function generateWrite() {
  if (writeBusy.value) return;
  if (!writeTopic.value.trim()) {
    error.value = '请填写报告主题';
    return;
  }
  writeBusy.value = true;
  error.value = '';
  writeResult.value = '';
  try {
    const r = await api.officeReportWrite({ topic: writeTopic.value.trim(), structure: writeStructure.value, requirements: writeRequirements.value.trim() });
    writeResult.value = r.text || '';
    loadOfficeHistory(); // 生成成功后刷新办公历史
  } catch (e) {
    error.value = e.message;
  } finally {
    writeBusy.value = false;
  }
}

// 报告网页化：调用对话模型生成单文件 HTML 专题页
// 报告网页化预设模板：点选即填入，可直接生成体验效果，也可改成自己的内容
const REPORT_TEMPLATES = [
  { name: '周报', style: '清爽商务风', content: [
    '# 第 42 周工作周报',
    '',
    '## 本周概览',
    '- 核心目标：完成办公助手模块的乱码自动修正功能上线',
    '- 完成度：95%（端到端验证通过，待用户实测反馈）',
    '',
    '## 重点工作',
    '| 事项 | 进展 | 说明 |',
    '| ---- | ---- | ---- |',
    '| 乱码检测修正 | 已上线 | 视觉模型定位+图片编辑替换，实测修正 12 处 |',
    '| 标签顺序调整 | 已完成 | 报告网页化置顶，提升入口曝光 |',
    '| 模板机制 | 开发中 | 预设 4 套模板，点选即用 |',
    '',
    '## 数据亮点',
    '- 信息图生成成功率：98%',
    '- 乱码自动修正命中率：85%',
    '- 平均生成耗时：65 秒',
    '',
    '## 下周计划',
    '1. 收集首批用户反馈并迭代',
    '2. 启动移动端适配第二批（顶栏/登录/账号设置）',
    '3. PWA 可行性调研',
  ].join('\n') },
  { name: '数据分析', style: '深色科技感', content: [
    '# 2026 年 Q3 用户增长分析',
    '',
    '## 核心结论',
    'Q3 新增用户 12.4 万，环比增长 38%，增长主要来自移动端渠道与老用户召回双轮驱动。',
    '',
    '## 关键指标',
    '| 指标 | Q2 | Q3 | 环比 |',
    '| ---- | ---- | ---- | ---- |',
    '| 新增用户 | 9.0 万 | 12.4 万 | +38% |',
    '| 次日留存 | 41% | 46% | +5pp |',
    '| 付费转化 | 2.1% | 2.8% | +0.7pp |',
    '',
    '## 增长拆解',
    '1. **移动端渠道**：贡献 62% 新增，应用商店评分提升至 4.8 是主因',
    '2. **老用户召回**：贡献 27% 新增，邮件召回打开率提升至 18%',
    '3. **自然流量**：贡献 11% 新增，SEO 优化长尾词覆盖翻倍',
    '',
    '## 风险与建议',
    '- 移动端渠道占比过高，需平衡渠道结构',
    '- 建议加大内容营销投入，提升自然流量占比至 15% 以上',
  ].join('\n') },
  { name: '项目复盘', style: '纸质档案风', content: [
    '# 『星图』项目复盘报告',
    '',
    '## 项目背景',
    '目标：6 周内上线数据可视化看板，支撑运营团队日常决策。',
    '结果：提前 1 周上线，覆盖 12 个核心场景，日活使用率 73%。',
    '',
    '## 做得好的',
    '1. **需求收敛快**：首周即锁定 MVP 范围，砍掉 40% 非核心需求',
    '2. **技术选型稳**：复用现有图表库，零新增依赖，交付零回滚',
    '3. **验收前置**：每轮迭代邀请运营参与验收，上线后无需求返工',
    '',
    '## 踩过的坑',
    '1. 数据接口性能瓶颈在联调后期才暴露，拖慢 3 天——应尽早压测',
    '2. 权限模型设计过度，实际只用到 2 级——应从最小可用开始',
    '',
    '## 下次怎么做',
    '- 接口压测纳入联调准入标准',
    '- 权限设计从简，按需扩展',
  ].join('\n') },
  { name: '会议纪要', style: '清爽商务风', content: [
    '# 产品周会会议纪要',
    '',
    '## 会议信息',
    '- 时间：2026 年 10 月 20 日 14:00-15:00',
    '- 参会：产品、研发、运营核心成员（共 8 人）',
    '- 主持：产品负责人',
    '',
    '## 议题与结论',
    '| 议题 | 结论 | 负责人 |',
    '| ---- | ---- | ---- |',
    '| 乱码修正功能上线 | 已上线，观察一周用户反馈 | 研发 |',
    '| 移动端适配排期 | 下周启动第二批（顶栏/登录/账号设置） | 前端 |',
    '| 新用户增长策略 | 邮件召回打开率提升，继续投入 | 运营 |',
    '',
    '## 待办事项',
    '1. 【研发】收集乱码修正功能的首周使用数据（10/27 前）',
    '2. 【前端】移动端第二批适配方案评审（10/22 前）',
    '3. 【运营】输出 10 月召回活动复盘报告（10/25 前）',
    '',
    '## 风险提示',
    '- 检测模型偶发不稳定，需保留人工反馈通道',
  ].join('\n') },
  { name: '竞品分析', style: '深色科技感', content: [
    '# 竞品分析：AI 办公工具赛道',
    '',
    '## 分析对象',
    '选取三款代表性产品：A 产品（大厂全能型）、B 产品（垂直报告型）、C 产品（海外新锐型）',
    '',
    '## 核心维度对比',
    '| 维度 | A 产品 | B 产品 | C 产品 |',
    '| ---- | ---- | ---- | ---- |',
    '| 报告生成 | 支持但模板少 | 核心优势，模板丰富 | 支持，偏英文场景 |',
    '| 简历制作 | 不支持 | 支持，文字偶有错乱 | 支持，中文支持弱 |',
    '| 价格 | 订阅制偏贵 | 按次计费 | 有免费额度 |',
    '| 中文优化 | 一般 | 较好 | 差',
    '',
    '## 差异化机会',
    '1. **文字准确性**：竞品简历/信息图普遍存在中文乱码，我们的程序化渲染+自动修正是明显差异点',
    '2. **单文件输出**：报告可离线分享，竞品多绑定平台',
    '3. **中文场景深耕**：模板与提示词全中文原生设计',
    '',
    '## 建议策略',
    '- 短期：放大『零乱码』卖点做内容营销',
    '- 中期：补齐模板数量对标 B 产品',
    '- 长期：构建办公场景工具矩阵',
  ].join('\n') },
  { name: '产品白皮书', style: '留白极简', content: [
    '# 智能办公助手产品白皮书',
    '',
    '## 产品定位',
    '面向中小团队的一站式 AI 办公工具，让报告、简历、信息图的生成从小时级降到分钟级。',
    '',
    '## 核心能力',
    '1. **报告网页化**：Markdown 一键转为可交互网页，支持多风格主题',
    '2. **简历图生成**：文字 100% 准确的程序化渲染，零乱码',
    '3. **信息图创作**：多布局多风格，自动检测并修正乱码文字',
    '',
    '## 技术特色',
    '- 视觉模型 + 图片编辑双模型协作，乱码自动修正',
    '- 单文件 HTML 输出，无外部依赖，可离线分享',
    '',
    '## 适用场景',
    '| 场景 | 使用频率 | 典型用户 |',
    '| ---- | ---- | ---- |',
    '| 周报月报 | 每周 | 职场新人 |',
    '| 求职简历 | 按需 | 应届毕业生 |',
    '| 数据汇报 | 每月 | 运营/分析师 |',
  ].join('\n') },
];

async function generateReport() {
  if (reportBusy.value) return;
  if (!reportContent.value.trim()) {
    error.value = '请填写报告内容';
    return;
  }
  reportBusy.value = true;
  error.value = '';
  reportHtml.value = '';
  try {
    const r = await api.officeReport({ content: reportContent.value.trim(), style: reportStyle.value.trim() });
    reportHtml.value = r.html || '';
    loadOfficeHistory(); // 生成成功后刷新办公历史
  } catch (e) {
    error.value = e.message;
  } finally {
    reportBusy.value = false;
  }
}

// 报告网页化：下载生成的 HTML 文件
function downloadReport() {
  if (!reportHtml.value) return;
  const blob = new Blob([reportHtml.value], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'report.html';
  a.click();
  URL.revokeObjectURL(a.href);
}

// 报告网页化：新窗口打开预览（iframe srcdoc 的替代查看方式）
function openReportWindow() {
  if (!reportHtml.value) return;
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(reportHtml.value);
    w.document.close();
  }
}
function openPptWindow() {
  if (!pptHtml.value) return;
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(pptHtml.value);
    w.document.close();
  }
}

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
    // 办公来源的提示词历史（与绘图工作台隔离），按当前标签加载（初始 tab 为信息图）
    const p = await api.drawPrompts(tab.value === 'resume' ? 'office:resume' : 'office:infographic');
    promptHistory.value = (p.rows || []).slice(0, 10);
  } catch { /* 静默 */ }
}

// 提示词历史按标签加载：信息图只看信息图的输入历史，简历图只看简历图的（各标签互不混杂）
async function loadPromptHistoryByTab() {
  if (tab.value !== 'infographic' && tab.value !== 'resume') return;
  try {
    const p = await api.drawPrompts(`office:${tab.value}`);
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

// 提示词历史：删除单条（与绘图工作台同款交互）
async function removePrompt(id) {
  try {
    await api.drawPromptDelete(id);
    promptHistory.value = promptHistory.value.filter((x) => x.id !== id);
  } catch { /* 静默 */ }
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
  loadOfficeHistory(); // 办公历史（报告网页化/演示文稿/报告写作）
});

// 信息图 / 简历图共用一个输入框，但内容互不干扰：各标签独立草稿，切换时保存与恢复
const contentDrafts = { infographic: '', resume: '' };

function switchTab(t) {
  // 离开的标签若是信息图/简历图，保存其输入草稿
  if (tab.value === 'infographic' || tab.value === 'resume') {
    contentDrafts[tab.value] = content.value;
  }
  tab.value = t;
  error.value = '';
  result.value = null;
  size.value = 'auto';
  // 目标标签若是信息图/简历图，恢复其草稿（简历示例不再漏进信息图输入框）
  if (t === 'infographic' || t === 'resume') {
    content.value = contentDrafts[t];
  }
  // 简历标签页：草稿为空时自动填入最佳实践示例——可直接生成体验效果，也可在示例上改成自己的内容
  if (t === 'resume' && !content.value.trim()) {
    content.value = RESUME_SAMPLE;
  }
  loadPromptHistoryByTab(); // 切换标签时刷新提示词历史（按标签隔离）
  if (t === 'report' || t === 'ppt' || t === 'write') loadOfficeHistory(); // 切到办公历史标签时刷新列表
}

// 简历最佳实践示例（实测验证过的格式：每行一个条目，短句经历）
const RESUME_SAMPLE = [
  '姓名：范例',
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
  garbleNote.value = ''; // 清空上次的修正提示
  if (tab.value === 'infographic') startGenStages(); // 信息图：阶段化进度提示
  try {
    const params = tab.value === 'infographic'
      ? { content: content.value.trim(), layout: layoutId.value, style: styleId.value, size: size.value, model: model.value }
      : { content: content.value.trim(), style: resumeStyle.value.trim(), size: size.value, model: model.value };
    const r = await (tab.value === 'infographic' ? api.officeInfographic(params) : api.officeResume(params));
    // 信息图：反馈自动修正结果（服务端检测修正乱码后返回 garbleFixed）
    if (tab.value === 'infographic' && r && r.garbleFixed > 0) {
      error.value = ''; // 不算错误
      garbleNote.value = `已自动修正 ${r.garbleFixed} 处乱码文字`;
    }
    await loadHistory(); // 生成成功后刷新历史画廊
    // 生成结果改用历史记录的签名 URL 显示：首次加载从服务器拉取并建立浏览器缓存，之后刷新直接命中缓存
    const latest = history.value[0];
    result.value = latest ? { url: latest.url, mode: latest.mode } : null;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
    stopGenStages();
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
        <button :class="{ on: tab === 'report' }" @click="switchTab('report')">📰 报告网页化</button>
        <button :class="{ on: tab === 'ppt' }" @click="switchTab('ppt')">🎞️ 演示文稿</button>
        <button :class="{ on: tab === 'resume' }" @click="switchTab('resume')">📄 简历图</button>
        <button :class="{ on: tab === 'infographic' }" @click="switchTab('infographic')">📈 信息图</button>
        <button :class="{ on: tab === 'chart' }" @click="switchTab('chart')">🔍 图表解读</button>
        <button :class="{ on: tab === 'excel' }" @click="switchTab('excel')">📊 Excel 分析</button>
        <button :class="{ on: tab === 'write' }" @click="switchTab('write')">📝 报告写作</button>
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

        <!-- 报告写作面板 -->
        <template v-else-if="tab === 'write'">
          <label class="field-label">报告结构（按读者认知任务选择）</label>
          <div class="option-grid">
            <button
              v-for="s in config.reportStructures"
              :key="s.id"
              class="option"
              :class="{ on: writeStructure === s.id }"
              :title="s.outline"
              @click="writeStructure = s.id"
            >{{ s.name }}</button>
          </div>
          <p v-if="config.reportStructures?.find((s) => s.id === writeStructure)" class="option-desc">{{ config.reportStructures.find((s) => s.id === writeStructure).desc }}</p>
          <label class="field-label">报告主题</label>
          <textarea v-model="writeTopic" class="content-input" rows="4" maxlength="2000" placeholder="示例：2026 年国内 AI 编程工具市场分析 / 自建 NAS 与云存储的选型对比"></textarea>
          <label class="field-label">补充要求（可选）</label>
          <input v-model="writeRequirements" class="style-input" placeholder="示例：侧重个人开发者视角 / 需要成本对比表格 / 控制在 2000 字内" maxlength="1000" />
          <button class="generate" :disabled="writeBusy" @click="generateWrite">
            {{ writeBusy ? '撰写中…（约需 30-90 秒）' : '生成报告' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
          <div v-if="writeResult" class="chart-result">
            <label class="field-label">报告内容</label>
            <div class="chart-text md" v-html="renderMd(writeResult)"></div>
          </div>
        </template>
        <!-- 报告网页化面板 -->
        <template v-else-if="tab === 'report'">
          <label class="field-label">快速开始：点选模板直接体验（可改成自己的内容）</label>
          <div class="option-grid">
            <button
              v-for="tpl in REPORT_TEMPLATES"
              :key="tpl.name"
              class="option-btn"
              @click="reportContent = tpl.content; reportStyle = tpl.style"
            >{{ tpl.name }}</button>
          </div>
          <label class="field-label">粘贴 Markdown 报告（周报 / 分析 / 复盘 / 白皮书，限 20000 字）</label>
          <textarea v-model="reportContent" class="content-input" rows="10" maxlength="20000" placeholder="粘贴你的 Markdown 报告内容…支持标题、列表、表格、数据等"></textarea>
          <label class="field-label">风格倾向（可选）</label>
          <input v-model="reportStyle" class="style-input" placeholder="示例：深色科技感 / 纸质档案风 / 留白极简（留空由 AI 按内容气质决定）" maxlength="200" />
          <button class="generate" :disabled="reportBusy" @click="generateReport">
            {{ reportBusy ? '创作中…（长文约需 1-3 分钟）' : '生成网页报告' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
          <div v-if="reportHtml" class="chart-result">
            <label class="field-label">预览（可交互）</label>
            <iframe :srcdoc="reportHtml" class="report-frame" sandbox="allow-scripts" title="报告预览"></iframe>
            <div class="report-actions">
              <button class="generate" @click="openReportWindow">新窗口打开</button>
              <button class="generate" @click="downloadReport">下载 HTML</button>
            </div>
          </div>
        </template>
        <!-- 演示文稿（PPT 简化版）面板 -->
        <template v-else-if="tab === 'ppt'">
          <label class="field-label">演示主题（也可以粘贴大纲或要点，AI 自动编排成幻灯片）</label>
          <textarea v-model="pptTopic" class="content-input" rows="4" maxlength="2000" placeholder="示例：新能源汽车市场趋势汇报 / 产品季度复盘 / 团队介绍"></textarea>
          <label class="field-label">页数</label>
          <select v-model.number="pptPages" class="style-input">
            <option v-for="n in [4, 6, 8, 10, 12]" :key="n" :value="n">{{ n }} 页</option>
          </select>
          <label class="field-label">配图</label>
          <label class="field" style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" v-model="pptWithImages" />
            <span>AI 为每页生成配图（关闭则纯文字，速度快很多）</span>
          </label>
          <button class="generate" :disabled="pptBusy" @click="runPpt">
            {{ pptBusy ? '生成中…（大纲约 10-30 秒，配图每页约 10 秒）' : '生成演示文稿' }}
          </button>
          <p v-if="error" class="error">{{ error }}</p>
          <div v-if="pptHtml" class="chart-result">
            <label class="field-label">预览（方向键翻页，可交互）</label>
            <iframe :srcdoc="pptHtml" class="report-frame" sandbox="allow-scripts" title="演示文稿预览"></iframe>
            <p v-if="pptMeta" class="field-label">共 {{ pptMeta.pageCount }} 页，配图 {{ pptMeta.imageCount }} 张</p>
            <div class="report-actions">
              <button class="generate" @click="openPptWindow">新窗口全屏演示</button>
              <button class="generate" @click="downloadPpt">下载 HTML</button>
            </div>
          </div>
        </template>
        <!-- 信息图 / 简历图面板 -->
        <template v-else>
        <!-- 提示词历史：点选填入（仅办公来源） -->
        <div v-if="promptHistory.length && tab !== 'chart'" class="prompt-tags">
          <span v-for="p in promptHistory" :key="p.id" class="prompt-tag">
            <span class="prompt-tag-text" :title="p.prompt" @click="usePrompt(p)">{{ p.prompt.slice(0, 18) }}…</span>
            <button class="prompt-tag-del" title="删除该提示词" @click="removePrompt(p.id)">✕</button>
          </span>
        </div>
        <!-- 内容输入 -->
        <label class="field-label">{{ tab === 'infographic' ? '信息图内容（主题、要点、数据）' : '简历内容（姓名、经历、技能、联系方式等）' }}</label>
        <textarea
          v-model="content"
          class="content-input"
          :rows="tab === 'resume' ? 12 : 8"
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
          {{ busy ? (tab === 'infographic' ? GEN_STAGES[genStage - 1] : '生成中…（大图约需 10-60 秒）') : (tab === 'infographic' ? '生成信息图' : '生成简历图') }}
        </button>
        <p class="model-line">当前模型：{{ model }}</p>
        <p v-if="garbleNote" class="garble-note">✔ {{ garbleNote }}</p>
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
      <p v-if="!filteredHistory.length && tab !== 'report' && tab !== 'ppt' && tab !== 'write'" class="history-empty">尚无生成结果</p>

      <!-- 办公历史（报告网页化/演示文稿/报告写作，24 小时暂存）：点选恢复内容到预览区 -->
      <div v-if="(tab === 'report' || tab === 'ppt' || tab === 'write') && filteredOfficeHistory.length" class="history">
        <label class="field-label">生成历史（24 小时保留，点选恢复内容）</label>
        <div v-for="r in filteredOfficeHistory" :key="r.id" class="history-item">
          <div class="history-meta">
            <span class="history-prompt" :title="r.title">{{ r.title }}</span>
            <span class="history-info">{{ officeTypeLabel(r.type) }}<template v-if="r.bytes"> · {{ formatBytes(r.bytes) }}</template> · {{ formatExpiry(r.created_at) }}</span>
            <div class="history-actions">
              <button class="history-btn" :disabled="officeRestoring === r.id" @click="restoreOfficeItem(r)">{{ officeRestoring === r.id ? '恢复中…' : '↩ 恢复' }}</button>
            </div>
          </div>
        </div>
      </div>
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
/* 标签栏：自适应布局（通用方案）——空间够单行铺满，不够自动整齐换行，不依赖断点 */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.tabs button {
  flex: 1 1 auto; /* 按内容自然宽度伸展，不再强制等分挤压 */
  min-width: 4em; /* 最小可点宽度 */
  white-space: nowrap; /* 文字永不折行 */
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
/* 报告网页化：iframe 预览（固定高度内滚动）+ 操作按钮排列 */
.report-frame {
  width: 100%;
  height: 480px;
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  background: #fff;
}
.report-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.report-actions .generate {
  flex: 1;
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
/* 信息图自动修正结果提示（非错误的成功反馈） */
.garble-note {
  color: #3fb950;
  font-size: 13px;
  margin: 8px 0 0;
}
/* 提示词历史标签（文字点选填入 + ✕ 删除，与绘图工作台同款交互） */
.prompt-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.prompt-tag {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  overflow: hidden;
}
.prompt-tag-text {
  font-size: 11px;
  color: var(--text-dim);
  padding: 3px 6px;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.prompt-tag-text:hover {
  color: var(--accent-2);
}
.prompt-tag-del {
  border: none;
  background: none;
  color: var(--text-dim);
  font-size: 11px;
  padding: 3px 6px;
  cursor: pointer;
}
.prompt-tag-del:hover {
  color: #f85149;
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
