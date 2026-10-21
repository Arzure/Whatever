// —— 文档解析：Word/PDF 文本提取（移植 sn-da-non-spreadsheet-analysis 思路，纯 JS 零系统依赖）——
const mammoth = require('mammoth');

// 大小限制：10MB（与前端上传约束一致）
const MAX_BYTES = 10 * 1024 * 1024;
// 提取文本上限：2 万字（足够大纲素材，防止超长文档拖垮提示词）
const MAX_CHARS = 20000;

// 清洗：统一换行、去控制字符
function cleanText(t) {
  let out = '';
  for (const ch of String(t)) {
    const code = ch.charCodeAt(0);
    if (code === 13) continue; // 回车
    if (code < 32 && code !== 10) continue; // 控制字符（保留换行）
    out += ch;
  }
  return out.trim();
}

/**
 * 解析上传文档为纯文本
 * @param {Buffer} buffer 文件二进制
 * @param {string} filename 原始文件名（按扩展名分发）
 * @returns {Promise<string>} 提取的文本
 * @throws {Error} 不支持的类型 / 文件过大 / 解析失败
 */
async function parseDocument(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('文件内容为空');
  if (buffer.length > MAX_BYTES) throw new Error('文件过大（限 10MB）');
  const ext = String(filename || '').toLowerCase().split('.').pop();
  let text = '';
  if (ext === 'docx') {
    const r = await mammoth.extractRawText({ buffer });
    text = r.value || '';
  } else if (ext === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const r = await parser.getText();
      text = (r && r.text) || '';
    } finally {
      await parser.destroy();
    }
  } else if (ext === 'doc') {
    throw new Error('暂不支持旧版 .doc，请另存为 .docx 后上传');
  } else {
    throw new Error('仅支持 .docx / .pdf 文档');
  }
  text = cleanText(text);
  if (!text) throw new Error('未能从文档中提取到文本（可能是扫描件/图片型 PDF）');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n...（文档过长，已截断）';
  return text;
}

module.exports = { parseDocument, MAX_BYTES, MAX_CHARS };
