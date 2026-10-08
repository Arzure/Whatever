import { reactive, computed } from 'vue';
import { api } from '../api';

/** 新游戏的开场行动（交给 AI 生成开场剧情） */
const FIRST_ACTION = '环顾四周，了解一下你身处何方，准备开始冒险！';

/**
 * 游戏状态与操作（组合式）。模式无关：由 state.mode / state.theme 决定界面如何渲染。
 * 通过 provide('game', useGame()) 注入，子组件 inject 取用。
 */
export function useGame() {
  const state = reactive({
    view: 'home', // home | game
    mode: 'world',
    theme: null,
    genre: null,
    gameId: '',
    player: null,
    history: [], // { role, content, choices? }
    pendingActions: [], // 待结算的按钮动作（可撤销）
    saves: [],
    modes: [],
    themes: [],
    genres: [],
    loading: false,
    error: '',
    gameOver: false,
    inBattle: false,
    lastEffects: [],
    // 探案模式专用视图（由后端 snapshot 提供，已剔除真相字段）
    caseTitle: '',
    detective: null,
    scenes: [],
    suspects: [],
    present: [],
    evidence: [], // 物证明细 [{id,name,desc,foundAt}]
    caseResult: null, // 案件告破复盘：{ got:[{text,holder}], missing:[{text,holder}], total }
    // 狼人杀模式专用视图（由后端 snapshot 提供，已剔除真相字段）
    wolf: null, // { phase, round, winner, playerRole, players, deaths, roles, aliveCount, canSpeak, canVote }
    // 推理杀模式专用视图（由后端 snapshot 提供，已剔除真相字段）
    deduction: null, // { phase, round, winner, players, deaths, roles, aliveCount, canAdjudicate }
  });

  const hpPercent = computed(() =>
    state.player ? Math.max(0, Math.min(100, (state.player.hp / state.player.maxHp) * 100)) : 0
  );

  const expPercent = computed(() => {
    if (!state.player || state.player.level <= 0) return 0;
    return Math.min(100, (state.player.exp / (state.player.level * 100)) * 100);
  });

  // ---------- 目录 / 存档 ----------
  async function refreshSaves() {
    try {
      state.saves = await api.listSaves();
    } catch (e) {
      state.error = e.message;
    }
  }

  async function loadCatalogs() {
    try {
      const [modes, themes, genres] = await Promise.all([
        api.listModes(),
        api.listThemes(),
        api.listGenres(),
      ]);
      state.modes = modes;
      state.themes = themes;
      state.genres = genres;
    } catch (e) {
      state.error = e.message;
    }
  }

  /** 把纯文本世界观交给 AI 结构化为可用的世界观配置 */
  function parseTheme(text) {
    return api.parseTheme(text);
  }

  // ---------- 开始 / 读档 ----------
  async function startGame({ playerName, mode, theme, genre }) {
    if (!playerName) {
      state.error = '请输入你的冒险者名字';
      return;
    }
    state.error = '';
    state.loading = true;
    try {
      const data = await api.createGame({ playerName, mode, theme, genre });
      enterGame(data);
    } catch (e) {
      state.error = e.message;
      state.loading = false;
      return;
    }
    state.loading = false;
    // 探案/狼人杀/推理杀模式以「开场简报」作为首条旁白，无需再自动跑一回合
    if (state.mode === 'detective' || state.mode === 'wolf' || state.mode === 'deduction') return;
    await submitAction(FIRST_ACTION);
  }

  async function loadSave(id) {
    state.error = '';
    state.loading = true;
    try {
      enterGame(await api.loadGame(id));
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
    }
  }

  function enterGame(data) {
    state.gameId = data.id;
    state.mode = data.mode || 'world';
    state.theme = data.theme || null;
    state.genre = data.genre || null;
    state.player = data.player;
    state.history = data.history || [];
    state.pendingActions = data.pendingActions || [];
    state.caseTitle = data.caseTitle || '';
    state.detective = data.detective || null;
    state.scenes = data.scenes || [];
    state.suspects = data.suspects || [];
    state.present = data.present || [];
    state.evidence = data.evidence || [];
    state.caseResult = data.caseResult || null;
    state.wolf = data.wolf || null;
    state.deduction = data.deduction || null;
    state.gameOver = isOver(data, data.player);
    state.inBattle = false;
    state.lastEffects = [];
    state.view = 'game';
  }

  /** 从任意响应中判定「游戏是否已结束」：优先模式判定，其次生命归零 */
  function isOver(data, player) {
    if (data && data.gameOver && typeof data.gameOver === 'object' && data.gameOver.over) return true;
    if (data && data.gameOver === true) return true;
    return !!(player && player.hp <= 0);
  }

  /** 重新拉取存档快照，同步探案模式的场景/在场者/阶段等派生状态 */
  async function syncGame() {
    if (!state.gameId) return;
    try {
      const data = await api.loadGame(state.gameId);
      state.player = data.player;
      state.history = data.history || [];
      state.pendingActions = data.pendingActions || [];
      state.caseTitle = data.caseTitle || state.caseTitle;
      state.detective = data.detective || state.detective;
      state.scenes = data.scenes || state.scenes;
      state.suspects = data.suspects || state.suspects;
      state.present = data.present || state.present;
      state.evidence = data.evidence || state.evidence;
      state.caseResult = data.caseResult || state.caseResult;
      state.wolf = data.wolf || state.wolf;
      state.deduction = data.deduction || state.deduction;
      state.gameOver = isOver(data, data.player);
    } catch (e) {
      // 快照刷新失败不影响本回合，本地状态已更新
    }
  }

  async function backToHome() {
    state.view = 'home';
    await refreshSaves();
  }

  function restart() {
    state.view = 'home';
    state.player = null;
    state.history = [];
    state.gameId = '';
    state.gameOver = false;
    state.detective = null;
    state.caseTitle = '';
    state.scenes = [];
    state.suspects = [];
    state.present = [];
    state.evidence = [];
    state.caseResult = null;
    state.wolf = null;
    state.deduction = null;
    refreshSaves();
  }

  // ---------- 物品按钮操作（AI 无权移动物品，全部由前端按钮触发）----------
  async function itemOp(op, body) {
    if (state.loading || state.gameOver || !state.gameId) return null;
    state.error = '';
    try {
      const data = await api.itemOp(state.gameId, op, body);
      state.player = data.player;
      state.pendingActions = data.pendingActions || [];
      return data.message;
    } catch (e) {
      state.error = e.message;
      return null;
    }
  }

  const useItem = (item) => itemOp('use-item', { item });
  const discardItem = (item) => itemOp('discard', { item });
  const equipItem = (item) => itemOp('equip', { item });
  const unequipItem = (slot) => itemOp('unequip', { slot });
  const cancelPending = (index) => itemOp('cancel-pending', { index });

  // ---------- 核心：执行动作 ----------
  async function submitAction(text, sceneId) {
    const actionText = String(text || '').trim();
    if (state.loading || state.gameOver || !actionText) return;
    state.error = '';
    state.loading = true;
    state.inBattle = false;

    // 回显玩家输入（含待结算的按钮动作）
    let displayText = actionText;
    if (state.pendingActions.length) {
      const pendingDesc = state.pendingActions.map((p) => p.message).join('，');
      displayText = `${actionText}（已操作：${pendingDesc}）`;
    }
    state.history.push({ role: 'user', content: displayText });

    try {
      const result = await api.action(state.gameId, actionText, sceneId);
      state.player = result.player;
      state.pendingActions = []; // 已随本次行动提交
      state.inBattle = result.battle;
      state.lastEffects = result.effects || [];
      if (result.detective) state.detective = result.detective;
      if (result.wolf) state.wolf = result.wolf;
      if (result.deduction) state.deduction = result.deduction;
      // 降级接续：AI 未按 JSON 格式返回，后端已直接接续剧情，用游戏内语言做过渡
      const narrative = result.degraded
        ? `${result.narrative}\n\n—— 你的举动在${state.theme?.name || state.caseTitle || '这个世界'}泛起涟漪，命运之线悄然转动。`
        : result.narrative;
      state.history.push({ role: 'assistant', content: narrative, choices: result.choices || [] });
      state.gameOver = result.gameOver || (state.player && state.player.hp <= 0);
      // 场景切换等派生状态由后端判定，刷新快照保持一致
      if (state.mode === 'detective') await syncGame();
    } catch (e) {
      // 出错时回滚刚才回显的玩家输入
      if (state.history.length && state.history[state.history.length - 1].role === 'user') {
        state.history.pop();
      }
      state.error = e.message;
    } finally {
      state.loading = false;
    }
  }

  // ---------- 探案模式：案件说明 / 指认 / 举证 ----------
  /** 拉取完整案件说明（含谜底）。仅在玩家主动展开时调用。 */
  async function loadCase() {
    if (!state.gameId) return null;
    state.error = '';
    try {
      const data = await api.getCase(state.gameId);
      return data.case;
    } catch (e) {
      state.error = e.message;
      return null;
    }
  }

  /** 指认凶手：正确进入对质阶段，错误扣血 */
  async function accuseSuspect(suspectId) {
    if (state.loading || state.gameOver || !state.gameId) return;
    state.error = '';
    state.loading = true;
    try {
      const result = await api.accuse(state.gameId, suspectId);
      applyTurn(result);
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
    }
  }

  /** 举证令凶手认罪：提交已掌握的线索 id */
  async function submitConfront(clueIds) {
    if (state.loading || state.gameOver || !state.gameId) return;
    state.error = '';
    state.loading = true;
    try {
      const result = await api.confront(state.gameId, clueIds);
      applyTurn(result);
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
    }
  }

  /** 指认/举证与普通行动共享同一种回合结构 */
  function applyTurn(result) {
    state.player = result.player;
    state.pendingActions = result.pendingActions || [];
    state.lastEffects = result.effects || [];
    if (result.detective) state.detective = result.detective;
    if (result.wolf) state.wolf = result.wolf;
    if (result.deduction) state.deduction = result.deduction;
    state.caseResult = result.caseResult || null;
    if (result.narrative) {
      state.history.push({ role: 'assistant', content: result.narrative, choices: result.choices || [] });
    }
    state.gameOver = !!result.gameOver || !!(state.player && state.player.hp <= 0);
    return syncGame();
  }

  /** 狼人杀：投票放逐目标 */
  async function voteTarget(targetId) {
    if (state.loading || state.gameOver || !state.gameId) return;
    state.error = '';
    state.loading = true;
    try {
      const result = await api.vote(state.gameId, targetId);
      applyTurn(result);
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
    }
  }

  /** 推理杀：法官裁决（targetId 为空 = 放弃处刑） */
  async function adjudicateTarget(targetId) {
    if (state.loading || state.gameOver || !state.gameId) return;
    state.error = '';
    state.loading = true;
    try {
      const result = await api.adjudicate(state.gameId, targetId || '');
      applyTurn(result);
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
    }
  }

  return {
    state,
    hpPercent,
    expPercent,
    refreshSaves,
    loadCatalogs,
    parseTheme,
    startGame,
    loadSave,
    backToHome,
    restart,
    submitAction,
    useItem,
    discardItem,
    equipItem,
    unequipItem,
    cancelPending,
    loadCase,
    accuseSuspect,
    submitConfront,
    voteTarget,
    adjudicateTarget,
  };
}
