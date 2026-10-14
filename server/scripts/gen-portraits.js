/**
 * 立绘资产生成脚本（一次性运行，可断点续传）。
 * 为 17 个角色各生成 VARIANTS 张（男性/中性）+ FEMALE_VARIANTS 张（女性，文件名带『女』）512x512 带阵营气质的半身头像，
 * 存入 server/assets/portraits/{role}-{n}.png，供游戏运行时随机抽取。
 * 用法：node server/scripts/gen-portraits.js
 */
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../config');
loadEnv();

const OUT_DIR = path.join(__dirname, '..', 'assets', 'portraits');
const VARIANTS = 3; // 每个角色生成几张（男性/中性版）
const FEMALE_VARIANTS = 2; // 每个角色女性版张数（控制成本）
const SIZE = '512x512';

// 角色池（与 server/modes/deduction.js 一致）
const ROLES = [
  { name: '文员', camp: 'good' }, { name: '侦探', camp: 'good' }, { name: '村民', camp: 'good' },
  { name: '法医', camp: 'good' }, { name: '守卫', camp: 'good' }, { name: '观者', camp: 'good' },
  { name: '邮差', camp: 'good' }, { name: '行者', camp: 'good' },
  { name: '赌徒', camp: 'neutral' }, { name: '小偷', camp: 'neutral' },
  { name: '庸医', camp: 'neutral' }, { name: '间谍', camp: 'neutral' },
  { name: '狼人', camp: 'evil' }, { name: '帮凶', camp: 'evil' }, { name: '酒鬼', camp: 'evil' },
  { name: '小丑', camp: 'evil' }, { name: '术士', camp: 'evil' },
];

// 阵营气质（与运行时提示词一致）
const CAMP_MOOD = {
  good: '气质温暖正直，眼神坚定，暖金色光晕点缀',
  neutral: '气质神秘莫测，眼神暧昧难辨，暗紫色调点缀',
  evil: '气质阴冷危险，眼神锐利带压迫感，暗红色调点缀',
};

// 生图请求（与 image.js 同构，但直接落盘为文件资产）
const REQUEST_TIMEOUT_MS = 90000;
async function generate(prompt) {
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
        model: cfg.model, prompt, n: 1, size: SIZE,
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tasks = [];
  for (const r of ROLES) {
    for (let v = 1; v <= VARIANTS; v++) {
      const file = path.join(OUT_DIR, `${r.name}-${v}.png`);
      if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue; // 断点续传：已存在跳过
      tasks.push({ ...r, v, file, female: false });
    }
    // 女性版立绘：文件名带『女』标记，运行时按角色名性别选取
    for (let v = 1; v <= FEMALE_VARIANTS; v++) {
      const file = path.join(OUT_DIR, `${r.name}-女${v}.png`);
      if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
      tasks.push({ ...r, v, file, female: true });
    }
  }
  if (!tasks.length) { console.log('全部资产已存在，无需生成。'); return; }
  console.log(`待生成 ${tasks.length} 张（每角色 ${VARIANTS} 张，${SIZE}）`);
  let ok = 0, fail = 0;
  // 3 并发生成，控制请求压力
  const CONCURRENCY = 3;
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      const prompt = `中世纪悬疑风格人物半身头像插画，${t.name}职业主题，${t.female ? '女性人物，' : ''}${CAMP_MOOD[t.camp]}，暗色调，深蓝金色配色，扁平插画风格，圆形构图，无文字`;
      try {
        const buf = await generate(prompt);
        fs.writeFileSync(t.file, buf);
        ok++;
        console.log(`[${ok + fail}/${tasks.length}] OK ${t.name}-${t.v} (${(buf.length / 1024).toFixed(0)}KB)`);
      } catch (e) {
        fail++;
        console.log(`[${ok + fail}/${tasks.length}] FAIL ${t.name}-${t.v}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`完成：成功 ${ok}，失败 ${fail}${fail ? '（重跑本脚本可续传补齐失败项）' : ''}`);
  process.exit(fail ? 1 : 0);
}
main();
