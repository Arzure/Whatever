const world = require('./world');
const detective = require('./detective');
const wolf = require('./wolf');
const deduction = require('./deduction');

/**
 * 游戏模式注册表。
 * 每个模式模块需导出：modeId / modeName / newGame / processAction / summarize，
 * 以及物品按钮操作（useItem / discardItem / equipItem / unequipItem / cancelPendingAction）。
 * - 需要世界观配置的模式导出 needsTheme: true。
 * - 需要案件题材的模式（探案）导出 needsGenre: true。
 * - 开局需调用 LLM 的模式导出 needsLLM: true。
 */
const MODES = {
  [world.modeId]: world,
  [detective.modeId]: detective,
  [wolf.modeId]: wolf,
  [deduction.modeId]: deduction,
};

const DEFAULT_MODE = world.modeId;

/** 按 id 取模式模块，未知 id 返回 null */
function getMode(id) {
  return MODES[id] || null;
}

/** 列出全部可用模式（供前端选择） */
function listModes() {
  return Object.values(MODES).map((m) => ({
    id: m.modeId,
    name: m.modeName,
    needsTheme: !!m.needsTheme,
    needsGenre: !!m.needsGenre,
  }));
}

module.exports = { getMode, listModes, DEFAULT_MODE };
