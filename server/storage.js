const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function savePath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

/** 存档文件：{ id, mode, theme, createdAt, updatedAt, player, history } */
function listSaves() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  const saves = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      saves.push({
        id: data.id,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        playerName: data.player?.name || '无名冒险者',
        level: data.player?.level || 1,
        mode: data.mode || 'world',
        themeName: data.theme?.name || data.genre?.name || '',
        caseTitle: data.case?.title || '',
      });
    } catch (e) {
      // 忽略损坏的存档文件
    }
  }
  saves.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return saves;
}

function saveGame(id, game) {
  ensureDir();
  fs.writeFileSync(savePath(id), JSON.stringify(game, null, 2), 'utf-8');
}

function loadGame(id) {
  const p = savePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function deleteGame(id) {
  const p = savePath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { listSaves, saveGame, loadGame, deleteGame };
