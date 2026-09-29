const fs = require('fs');
const path = require('path');

/**
 * 极简 .env 加载器（避免引入 dotenv 依赖）。
 * 只负责把 .env 中的变量写入 process.env（已存在的环境变量优先级更高）。
 */
function loadEnv(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

module.exports = { loadEnv };
