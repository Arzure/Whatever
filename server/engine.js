const { chat } = require('./llm');
const { parseItem } = require('./quality');

/**
 * 引擎共享层：与具体模式（大世界 / 探案）无关的通用能力。
 * - LLM 回合调用（自动重试 + 降级兜底）
 * - AI 输出 JSON 的容错解析
 * - 背包/装备槽的按钮操作（使用 / 丢弃 / 装备 / 卸下 / 撤销）
 */

/**
 * 解析 LLM 返回的动作 JSON。
 * 兼容 markdown 代码块包裹；若输出中不包含合法 JSON（如模型输出了纯文本剧情），返回 null。
 * @param {string} text LLM 原始输出
 * @returns {object|null}
 */
function parseActionJson(text) {
  const trimmed = String(text || '').trim();
  // 兼容 LLM 输出被 markdown 代码块包裹的情况
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;

  // 尝试提取第一个 {...} 块
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null; // 纯文本，无 JSON 对象
  }

  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return typeof obj === 'object' && obj !== null ? obj : null;
  } catch (e) {
    return null; // JSON 非法
  }
}

/**
 * 执行一个 LLM 回合：首次解析失败时用精简提示词自动重试一次；仍失败则降级为纯文本接续。
 * @param {{ messages: Array, retryMessages?: Array, maxTokens?: number, temperature?: number }} opts
 * @returns {Promise<{ action: object|null, degraded: boolean, narrative: string }>}
 *   action 为 null 且 degraded 为 true 时，narrative 为可直接展示的纯文本剧情。
 */
async function runTurn({ messages, retryMessages, maxTokens = 4096, temperature = 0.9 }) {
  const text = await chat(messages, { temperature, maxTokens });
  let action = parseActionJson(text);

  if (action === null && retryMessages) {
    console.log('[debug] 首次解析失败，尝试重试…');
    try {
      const retryText = await chat(retryMessages, { temperature, maxTokens });
      action = parseActionJson(retryText);
      console.log('[debug] 重试结果:', action === null ? '仍失败' : '成功');
    } catch (e) {
      console.log('[debug] 重试请求异常:', String(e.message).slice(0, 60));
      action = null;
    }
  }

  if (action === null) {
    return { action: null, degraded: true, narrative: String(text).trim().slice(0, 2000) };
  }
  return { action, degraded: false, narrative: '' };
}

// ==================== 背包 / 装备槽的按钮操作 ====================

/**
 * 从背包移除物品，支持带数量的条目（如「干粮 x2」）。
 * 数量由物品名末尾的「 xN」解析；未带数量则完整移除单个条目。
 * @returns {boolean} 是否成功移除
 */
function removeFromInventory(player, effects, itemName) {
  const trimmed = String(itemName || '').trim();
  if (!trimmed) return false;

  // 解析名称与数量：「干粮 x2」→ { name: '干粮', count: 2 }
  const countMatch = trimmed.match(/^(.*?)\s*[x×](\d+)$/i);
  const targetName = countMatch ? countMatch[1].trim() : trimmed;
  const targetCount = countMatch ? parseInt(countMatch[2], 10) : 1;

  // 装备类（武器/防具）与道具的文案区分
  const { type } = parseItem(targetName);
  const isEquip = type === 'weapon' || type === 'armor';
  const removePhrase = (n, extra = '') =>
    isEquip ? `背包移除「${n}」${extra}` : `失去「${n}」${extra}`;

  // 在背包中查找同名条目
  for (let i = 0; i < player.inventory.length; i++) {
    const entry = player.inventory[i];
    const entryMatch = entry.match(/^(.*?)\s*[x×](\d+)$/i);
    const entryName = entryMatch ? entryMatch[1].trim() : entry;
    if (entryName !== targetName) continue;

    if (entryMatch && entryMatch[2] !== undefined) {
      // 背包条目带数量：扣减
      const newCount = parseInt(entryMatch[2], 10) - targetCount;
      if (newCount <= 0) {
        player.inventory.splice(i, 1);
        effects.push(removePhrase(targetName));
      } else {
        player.inventory[i] = `${entryName} x${newCount}`;
        effects.push(removePhrase(targetName, `x${targetCount}，剩余 x${newCount}`));
      }
    } else {
      // 背包条目不带数量：视为单件，直接移除
      player.inventory.splice(i, 1);
      effects.push(removePhrase(targetName));
    }
    return true;
  }

  // 背包中完全没有（可能是按钮操作已移除的重复声明，静默忽略，不打扰玩家）
  return false;
}

/**
 * 恢复道具到背包（支持数量合并）。
 * 例如背包现有「干粮 x1」，恢复「干粮 x1」→ 合并为「干粮 x2」。
 */
function restoreItem(player, itemName) {
  const countMatch = String(itemName).match(/^(.*?)\s*[x×](\d+)$/i);
  const name = countMatch ? countMatch[1].trim() : String(itemName).trim();
  const count = countMatch ? parseInt(countMatch[2], 10) : 1;

  for (let i = 0; i < player.inventory.length; i++) {
    const entry = player.inventory[i];
    const entryMatch = entry.match(/^(.*?)\s*[x×](\d+)$/i);
    if (entryMatch && entryMatch[1].trim() === name) {
      player.inventory[i] = `${name} x${parseInt(entryMatch[2], 10) + count}`;
      return;
    }
    if (!entryMatch && entry === name) {
      player.inventory[i] = `${name} x${1 + count}`;
      return;
    }
  }
  player.inventory.push(itemName);
}

/**
 * 使用道具：从背包移除（默认 1 个），记为待结算动作（效果延迟到下次 AI 回合结算）。
 * @returns {{ok: boolean, pending: object|null, message: string}}
 */
function useItem(game, itemName) {
  const player = game.player;
  const effects = [];
  // 按钮点击默认只使用 1 个：即使条目带数量（如「干粮 x2」）也按 x1 扣减
  const countMatch = String(itemName).match(/^(.*?)\s*[x×](\d+)$/i);
  const useOne = countMatch ? `${countMatch[1].trim()} x1` : String(itemName).trim();
  const ok = removeFromInventory(player, effects, useOne);
  if (!ok) {
    return { ok: false, pending: null, message: `背包里没有「${useOne}」` };
  }
  const pending = { type: 'use', item: useOne, message: `使用「${useOne}」` };
  game.pendingActions.push(pending);
  game.updatedAt = Date.now();
  return { ok: true, pending, message: pending.message };
}

/**
 * 丢弃背包中的物品（默认丢弃 1 个），记为待结算动作。
 */
function discardItem(game, itemName) {
  const player = game.player;
  const effects = [];
  const countMatch = String(itemName).match(/^(.*?)\s*[x×](\d+)$/i);
  const discardOne = countMatch ? `${countMatch[1].trim()} x1` : String(itemName).trim();
  const ok = removeFromInventory(player, effects, discardOne);
  if (!ok) {
    return { ok: false, pending: null, message: `背包里没有「${discardOne}」` };
  }
  const pending = { type: 'discard', item: discardOne, message: `丢弃「${discardOne}」` };
  game.pendingActions.push(pending);
  game.updatedAt = Date.now();
  return { ok: true, pending, message: pending.message };
}

/**
 * 装备背包中的武器/防具到对应槽位（立即生效，写入待结算动作供 AI 感知）。
 * 槽位需存在于 player.slots（由世界观 capabilities.slots 决定）。
 */
function equipItem(game, itemName) {
  const player = game.player;
  const { type, name } = parseItem(itemName);
  if (type !== 'weapon' && type !== 'armor') {
    return { ok: false, message: `「${name}」不是武器或防具` };
  }
  const slot = type === 'weapon' ? 'weapon' : 'armor';
  if (!player.slots || !(slot in player.slots)) {
    return { ok: false, message: '当前世界观没有该装备槽位' };
  }
  const idx = player.inventory.indexOf(itemName);
  if (idx === -1) return { ok: false, message: `背包里没有「${itemName}」` };
  // 卸下当前装备放回背包
  player.inventory.splice(idx, 1);
  if (player.slots[slot]) player.inventory.push(player.slots[slot]);
  player.slots[slot] = itemName;
  game.pendingActions.push({ type: 'equip', item: itemName, message: `装备「${itemName}」` });
  game.updatedAt = Date.now();
  return { ok: true, message: `已装备「${itemName}」` };
}

/**
 * 卸下当前武器/防具到背包（立即生效，写入待结算动作供 AI 感知）。
 */
function unequipItem(game, slot) {
  const player = game.player;
  if (!player.slots || !(slot in player.slots)) return { ok: false, message: '无效的槽位' };
  const current = player.slots[slot];
  if (!current) return { ok: false, message: '当前没有装备该物品' };
  player.inventory.push(current);
  player.slots[slot] = null;
  game.pendingActions.push({ type: 'unequip', slot, item: current, message: `卸下「${current}」` });
  game.updatedAt = Date.now();
  return { ok: true, message: `已卸下「${current}」` };
}

/**
 * 撤销待结算动作：恢复道具到背包。
 */
function cancelPendingAction(game, index) {
  const pending = game.pendingActions[index];
  if (!pending) return { ok: false, message: '待结算动作不存在' };
  if (pending.type === 'use' || pending.type === 'discard') {
    restoreItem(game.player, pending.item);
    game.pendingActions.splice(index, 1);
    game.updatedAt = Date.now();
    return { ok: true, message: `已撤销「${pending.type === 'use' ? '使用' : '丢弃'}${pending.item}」，道具已恢复` };
  }
  return { ok: false, message: '该类型动作暂不支持撤销' };
}

/** 清空待结算动作（提交给 AI 前调用） */
function clearPendingActions(game) {
  game.pendingActions = [];
}

module.exports = {
  parseActionJson,
  runTurn,
  removeFromInventory,
  restoreItem,
  useItem,
  discardItem,
  equipItem,
  unequipItem,
  cancelPendingAction,
  clearPendingActions,
};
