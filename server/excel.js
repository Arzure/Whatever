/**
 * Excel 数据分析（办公助手阶段 2 第二能力）。
 * 解析借鉴商汤开源技能 sn-da-excel-workflow 的工程模式：
 * - 大文件分级策略：本项目简化为限制上传行数（≤5000 行），超限拒绝——个人项目场景够用，
 *   技能原版的 Parquet 缓存/流式读取面向 10 万行级，暂不需要
 * - 数据摘要而非全量进提示词：统计概览 + 前若干行样本交给对话模型分析
 * 解析用 xlsx 库（纯 JS 零原生依赖）；分析走对话链路（自由文本输出）。
 */
const XLSX = require('xlsx');

const MAX_ROWS = 5000; // 上传行数上限（超限拒绝，防内存与提示词溢出）
const SAMPLE_ROWS = 30; // 交给对话模型的数据样本行数（摘要而非全量）

/**
 * 解析上传的 Excel/CSV 文件 Buffer。
 * 返回 { sheets: [{ name, headers, rows, rowCount }], totalRows } 或 { error }。
 */
function parseExcel(buf) {
  let wb;
  try {
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch (e) {
    return { error: '文件解析失败：不是有效的 Excel/CSV 文件' };
  }
  const sheets = [];
  let totalRows = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    // header:1 输出二维数组；第一行视为表头
    const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    if (!all.length) { sheets.push({ name, headers: [], rows: [], rowCount: 0 }); continue; }
    const headers = (all[0] || []).map((h) => String(h == null ? '' : h).trim());
    const rows = all.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== ''));
    totalRows += rows.length;
    sheets.push({ name, headers, rows, rowCount: rows.length });
  }
  if (totalRows > MAX_ROWS) {
    return { error: `数据量过大（共 ${totalRows} 行，上限 ${MAX_ROWS} 行）——请拆分文件或筛选后上传` };
  }
  if (totalRows === 0) {
    return { error: '文件中没有可分析的数据行' };
  }
  return { sheets, totalRows };
}

/**
 * 组装分析提示词：数据概览 + 样本行 + 用户问题 → 交给对话模型。
 * 摘要策略：全量统计（每 Sheet 行数/列名）+ 前 SAMPLE_ROWS 行样本，避免全量数据撑爆提示词。
 */
function buildAnalysisPrompt(parsed, question) {
  const parts = [];
  parts.push('以下是用户上传的表格数据，请进行数据分析。');
  for (const s of parsed.sheets) {
    parts.push(`\n## Sheet「${s.name}」（${s.rowCount} 行数据）`);
    parts.push(`列名：${s.headers.join('、')}`);
    const sample = s.rows.slice(0, SAMPLE_ROWS).map((r) => r.map((c) => (c == null ? '' : String(c))).join(' | '));
    parts.push(`前 ${sample.length} 行样本（竖线分隔，按列名顺序）：`);
    parts.push(sample.map((l) => l).join('\n'));
  }
  parts.push(`\n请输出：1) 数据概览（各 Sheet 的行列结构与数据类型）；2) 关键统计（数值列的分布/汇总，分类列的类别构成）；3) 值得注意的规律或异常；4) 简明的结论与建议。使用中文，条理清晰，总长不超过 800 字。`);
  if (question && question.trim()) {
    parts.push(`\n用户特别关注的问题：${question.trim()}`);
  }
  return parts.join('\n');
}

module.exports = { parseExcel, buildAnalysisPrompt, MAX_ROWS };
