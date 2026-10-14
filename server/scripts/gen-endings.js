/**
 * 终局剪影资产生成脚本（一次性运行，可断点续传）。
 * 产出两部分：
 * 1. 背景：win-1..5.png / lose-1..5.png（768x768，成功/失败各 5 张）；
 * 2. 人物剪影：{职业}-剪-{男|女}.png（17 职业 × 2 性别，纯黑背景生成后由
 *    process_silhouette.py 转为透明背景 PNG，便于叠放在背景图上）。
 * 用法：node server/scripts/gen-endings.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadEnv } = require('../config');
loadEnv();

const OUT_DIR = path.join(__dirname, '..', 'assets', 'endings');
const BG_COUNT = 5; // 每种结局背景张数
const SIZE = '768x768';

const ROLES = [
  '文员', '侦探', '村民', '法医', '守卫', '观者', '邮差', '行者',
  '赌徒', '小偷', '庸医', '间谍',
  '狼人', '帮凶', '酒鬼', '小丑', '术士',
];

const REQUEST_TIMEOUT_MS = 90000;
async function generate(prompt, size) {
  const cfg = {
    baseUrl: (process.env.IMAGE_BASE_URL || 'https://token.sensenova.cn/v1').replace(/\/+$/, ''),
    apiKey: process.env.IMAGE_API_KEY || process.env.LLM_API_KEY || '',
    model: process.env.IMAGE_MODEL || '',
  };
  if (!cfg.model || !cfg.apiKey) throw new Error('未配置 IMAGE_MODEL 或 API Key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model, prompt, n: 1, size,
        response_format: 'b64_json', watermark: false, prompt_extend: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('响应中无图片数据');
    return Buffer.from(b64, 'base64');
  } finally {
    clearTimeout(timer);
  }
}

// 剪影透明化：调用 Python 脚本把纯黑背景转为透明
function makeTransparent(file) {
  execFileSync('python3', [path.join(__dirname, 'process_silhouette.py'), file], { stdio: 'inherit' });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tasks = [];
  // 背景：成功/失败各 5 张
  for (let i = 1; i <= BG_COUNT; i++) {
    const winFile = path.join(OUT_DIR, `win-${i}.png`);
    if (!(fs.existsSync(winFile) && fs.statSync(winFile).size > 1000)) {
      tasks.push({ type: 'bg', win: true, i, file: winFile, prompt: `暗色调中世纪村庄剪影插画，黎明胜利结局，晨光穿透云层照亮村庄，温暖金色光芒，神秘悬疑氛围，扁平插画风格，深蓝与金色配色，无人物，无文字` });
    }
    const loseFile = path.join(OUT_DIR, `lose-${i}.png`);
    if (!(fs.existsSync(loseFile) && fs.statSync(loseFile).size > 1000)) {
      tasks.push({ type: 'bg', win: false, i, file: loseFile, prompt: `暗色调中世纪村庄剪影插画，黑夜失败结局，浓雾笼罩的村庄轮廓，阴冷月光，压抑恐怖氛围，扁平插画风格，深蓝与暗紫色配色，无人物，无文字` });
    }
  }
  // 人物剪影：17 职业 × 男女
  for (const role of ROLES) {
    for (const gender of ['男', '女']) {
      const file = path.join(OUT_DIR, `${role}-剪-${gender}.png`);
      if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
      tasks.push({
        type: 'silhouette', role, gender, file,
        prompt: `纯黑色背景上的人物全身剪影，${gender}性${role}职业姿态，人物剪影为明亮的宝蓝色与纯黑背景形成强烈高对比，人物轮廓清晰锐利，姿态反映职业特征，背景必须为纯黑色无任何元素，无文字`,
      });
    }
  }
  if (!tasks.length) { console.log('全部资产已存在，无需生成。'); return; }
  console.log(`待生成 ${tasks.length} 项（背景 ${tasks.filter(t => t.type === 'bg').length} + 剪影 ${tasks.filter(t => t.type === 'silhouette').length}）`);
  let ok = 0, fail = 0;
  const CONCURRENCY = 3;
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        const buf = await generate(t.prompt, t.type === 'bg' ? SIZE : '512x512');
        fs.writeFileSync(t.file, buf);
        if (t.type === 'silhouette') makeTransparent(t.file); // 剪影透明化
        ok++;
        console.log(`[${ok + fail}/${tasks.length}] OK ${path.basename(t.file)}${t.type === 'silhouette' ? '（已透明化）' : ''}`);
      } catch (e) {
        fail++;
        console.log(`[${ok + fail}/${tasks.length}] FAIL ${path.basename(t.file)}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`完成：成功 ${ok}，失败 ${fail}${fail ? '（重跑本脚本可续传补齐失败项）' : ''}`);
  process.exit(fail ? 1 : 0);
}
main();
