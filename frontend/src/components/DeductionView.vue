<script setup>
import { ref, computed, onMounted, nextTick, watch, inject, Transition } from 'vue';
import { api } from '../api';
import NightActionGraph from './NightActionGraph.vue';
import EndModal from './EndModal.vue';

const { state, listenSpeeches, adjudicateTarget, restart } = inject('game');

const messagesEl = ref(null);
const showRoles = ref(false);

// —— 阅读重点强化：发言者着色 + 关键词标记 + 按天分组 ——
// 每位玩家固定颜色（按玩家序号取色，全流一致）
const PLAYER_COLORS = ['#58a6ff', '#f0883e', '#3fb950', '#db61a2', '#d29922', '#a371f7', '#39c5cf', '#ff7b72', '#7ee787', '#ffa657'];
// —— 发言卡片视觉：死者/被处刑者判断（用于卡片变灰与红框） ——
function isDeadName(name) {
  const p = (d.value.players || []).find((x) => x.name === name);
  return p ? !p.alive : false;
}
function isExecutedName(name) {
  return (d.value.deaths || []).some((x) => x.name === name && x.cause === 'execute');
}
// 终局阵营着色：按真实身份返回阵营类名（好人蓝/中立黄/坏人红），非终局返回空
function campClassOfName(name) {
  if (!state.gameOver) return '';
  const r = (d.value.roles || []).find((x) => x.name === name);
  if (!r) return '';
  const role = r.roleBackup || r.role;
  if (EVIL_ROLES.includes(role)) return 'msg-camp-evil';
  if (NEUTRAL_ROLES.includes(role)) return 'msg-camp-neutral';
  return 'msg-camp-good';
}
function playerColor(name) {
  const idx = (d.value.players || []).findIndex((p) => p.name === name);
  return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length] : 'var(--text, #e6edf3)';
}
// 关键词标记：把发言文本解析为富文本片段（身份声明加粗 / 线索强调 / 质疑警示）
const CLAIM_RE = /我是(文员|侦探|村民|法医|守卫|赌徒|小偷|狼人|帮凶|酒鬼|观者|邮差|行者|庸医|间谍|小丑|术士)/g;
const CLUE_RE = /(曾外出活动|没有外出活动|呆在家中|整夜在家|验明了?死者[^。]{0,12}的真实身份|阵营是[^。]{0,6}|探得[^。]{0,8}阵营|探明[^。]{0,10}身份|守护了|保护了|送了一封信|递了一碗药|猜了[^。]{0,8}的阵营)/g;
const DOUBT_RE = /(撒谎|伪装|假冒|对不上|冲突|矛盾|不可能有两人|不可能两人|身份对跳|质疑|留意)/g;
function parseSpeech(text) {
  const segments = [];
  let last = 0;
  const marks = [];
  let m;
  CLAIM_RE.lastIndex = 0;
  while ((m = CLAIM_RE.exec(text)) !== null) marks.push({ s: m.index, e: m.index + m[0].length, cls: 'mk-claim' });
  CLUE_RE.lastIndex = 0;
  while ((m = CLUE_RE.exec(text)) !== null) marks.push({ s: m.index, e: m.index + m[0].length, cls: 'mk-clue' });
  DOUBT_RE.lastIndex = 0;
  while ((m = DOUBT_RE.exec(text)) !== null) marks.push({ s: m.index, e: m.index + m[0].length, cls: 'mk-doubt' });
  marks.sort((a, b) => a.s - b.s);
  for (const mk of marks) {
    if (mk.s < last) continue; // 重叠标记跳过（前面的优先）
    if (mk.s > last) segments.push({ text: text.slice(last, mk.s) });
    segments.push({ text: text.slice(mk.s, mk.e), cls: mk.cls });
    last = mk.e;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
// 发言者名字：解析「名字」：前缀
function parseSpeaker(text) {
  const m = text.match(/^「([^」]+)」：/);
  return m ? { name: m[1], rest: text.slice(m[0].length) } : null;
}
// 按天分组：把历史记录拆成『天』的数组
// 注意：天标记（—— 第 N 天 ——）可能嵌在消息中间（裁决结果之后），需从标记处拆分消息
const dayGroups = computed(() => {
  const groups = [];
  let cur = null;
  const push = (content) => {
    if (!cur) { cur = { day: 1, msgs: [] }; groups.push(cur); }
    // 过滤：终局复盘长文本（改由结算弹窗展示）；纯天标记消息（改由夜事件弹窗展示）
    let c = content;
    const endIdx = c.indexOf('—— 游戏结束 ——');
    if (endIdx >= 0) c = c.slice(0, endIdx);
    // 过滤：处刑叙事文本（改由处刑结果弹窗展示）——从叙事起点删至下一个天标记/游戏结束标记/末尾
    const execStart = c.search(/你举起法槌|决定【放弃处刑】/);
    if (execStart >= 0) {
      const rest = c.slice(execStart);
      const endMatch = rest.match(/—— 第 \d+ 天 ——|—— 游戏结束 ——/);
      c = (c.slice(0, execStart) + (endMatch ? rest.slice(endMatch.index) : '')).trim();
    }
    // 分离：服务端附加的裁决提示文本——保留为独立消息（不带「名字」前缀，走纯文本渲染），
    // 避免被拆分逻辑并入末位发言者卡片；裁决信息本身是有效提示，不应丢弃
    let adjudicateTip = '';
    const adjIdx = c.search(/——\s*现在由你裁决|所有人都沉默了。现在由你裁决/);
    if (adjIdx >= 0) {
      adjudicateTip = c.slice(adjIdx).trim();
      c = c.slice(0, adjIdx).trim();
    }
    c = c.trim();
    if (c && /^—— 第 \d+ 天 ——\s*\n*\s*天亮了。?\s*$/.test(c)) c = ''; // 纯天标记消息跳过（改由夜事件弹窗展示）
    // 拆分合并发言：服务端可能把全天发言合并在一条消息里（『大家的发言如下：\n「A」：…\n「B」：…』），
    // 按行首「名字」：标记拆成独立消息，使发言卡片化（专属色竖条/首字徽章/阵营着色）逐条生效
    if (c) {
      const segRe = /(?:^|\n)「([^」]+)」：/g;
      const segs = [];
      let sm;
      while ((sm = segRe.exec(c)) !== null) segs.push({ idx: sm.index });
      if (segs.length > 1 || (segs.length === 1 && segs[0].idx > 0)) {
        const head = c.slice(0, segs[0].idx).trim();
        if (head) cur.msgs.push({ role: 'assistant', content: head });
        for (let i = 0; i < segs.length; i++) {
          const to = i + 1 < segs.length ? segs[i + 1].idx : c.length;
          cur.msgs.push({ role: 'assistant', content: c.slice(segs[i].idx, to).trim() });
        }
      } else {
        cur.msgs.push({ role: 'assistant', content: c });
      }
    }
    // 裁决提示作为独立消息追加（无角色前缀，渲染为普通提示而非发言卡片）
    if (adjudicateTip) cur.msgs.push({ role: 'assistant', content: adjudicateTip });
  };
  for (const msg of state.history || []) {
    const content = String(msg.content || '');
    // 在消息中查找所有天标记的位置（不限开头）
    const dayRe = /—— 第 (\d+) 天 ——/g;
    const marks = [];
    let m;
    while ((m = dayRe.exec(content)) !== null) marks.push({ idx: m.index, day: Number(m[1]) });
    if (!marks.length) { push(content); continue; }
    // 按天标记拆分：标记前的内容归上一组，标记处开新组
    let pos = 0;
    for (const mk of marks) {
      if (mk.idx > pos) push(content.slice(pos, mk.idx));
      cur = { day: mk.day, msgs: [] };
      groups.push(cur);
      pos = mk.idx;
    }
    push(content.slice(pos));
  }
  return groups;
});
// 死讯折叠：默认只显示最近两条，点击展开全部
const showAllDeaths = ref(false);

// —— 矛盾自动标注：检测发言中的身份对跳（同一身份被多人声明） ——
// 返回该发言者声明身份的对跳对手名单（无对跳返回空数组）
function claimConflictsOf(name) {
  const claims = d.value.claims || [];
  const mine = claims.find((c) => c.name === name);
  if (!mine) return [];
  return claims.filter((c) => c.playerId !== mine.playerId && c.claimed === mine.claimed).map((c) => c.name);
}

// —— 回到底部悬浮按钮 ——
const showBackBottom = ref(false);
function onMessagesScroll() {
  const el = messagesEl.value;
  if (!el) return;
  showBackBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight;
}
function scrollToLatest() {
  const el = messagesEl.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

// —— 移动端底部抽屉：覆盖式面板，页面不滚动、阅读位置保持不变 ——
const drawer = ref(''); // '' | players | claims | roles
function openDrawer(name) {
  drawer.value = name;
  if (name === 'roles') showRoles.value = true; // 角色说明抽屉默认展开能力卡
}
function closeDrawer() {
  drawer.value = '';
}

// —— 玩家标记（推测身份笔记）：仅存本地浏览器、按游戏隔离，不上传服务器、不影响游戏逻辑 ——
const BASE_ROLES = ['文员', '侦探', '村民', '法医', '守卫', '赌徒', '小偷', '狼人', '帮凶', '酒鬼'];
const ADV_ROLES = [...BASE_ROLES, '观者', '邮差', '行者', '庸医', '间谍', '小丑', '术士'];
const marks = ref({});
const markOpenId = ref('');
const MARK_KEY = computed(() => `rpg_marks_${state.gameId || ''}`);
const NEUTRAL_ROLES = ['赌徒', '小偷', '庸医', '间谍'];
const EVIL_ROLES = ['狼人', '帮凶', '酒鬼', '小丑', '术士'];
const CAMP_ORDER = { 好人: 0, 中立: 1, 坏人: 2 };
// 角色标记按阵营归类排列：好人 → 中立 → 坏人，同类阵营放在一起
const ALL_ROLES = computed(() => {
  const roles = d.value.board === 'advanced' ? ADV_ROLES : BASE_ROLES;
  return [...roles].sort((a, b) => CAMP_ORDER[campOfRole(a)] - CAMP_ORDER[campOfRole(b)]);
});
function roleClass(role) {
  if (EVIL_ROLES.includes(role)) return 'role-wolf';
  if (NEUTRAL_ROLES.includes(role)) return 'role-neutral';
  return 'role-good';
}
// 阵营标记选项（不确定具体角色时，可只标记阵营）
const CAMP_MARKS = ['好人', '中立', '坏人'];
function campOfRole(role) {
  if (EVIL_ROLES.includes(role)) return '坏人';
  if (NEUTRAL_ROLES.includes(role)) return '中立';
  return '好人';
}
// 标记专用分类：阵营名直接映射阵营颜色，角色名按所属阵营着色
function markClass(mark) {
  if (CAMP_MARKS.includes(mark)) {
    if (mark === '坏人') return 'role-wolf';
    if (mark === '中立') return 'role-neutral';
    return 'role-good';
  }
  return roleClass(mark);
}
function loadMarks() {
  // 先用本地缓存立即渲染，再从云端拉取最新（跨设备同步）
  try {
    marks.value = JSON.parse(localStorage.getItem(MARK_KEY.value) || '{}');
  } catch {
    marks.value = {};
  }
  if (state.gameId) {
    api.getMarks(state.gameId)
      .then((r) => {
        if (r.marks && Object.keys(r.marks).length) {
          marks.value = r.marks;
          try { localStorage.setItem(MARK_KEY.value, JSON.stringify(marks.value)); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* 云端不可用时保持本地缓存 */ });
  }
}
function saveMarks() {
  try {
    localStorage.setItem(MARK_KEY.value, JSON.stringify(marks.value));
  } catch {
    /* ignore */
  }
  // 云端同步（失败不影响本地使用）
  if (state.gameId) {
    api.saveMarks(state.gameId, marks.value).catch(() => { /* ignore */ });
  }
}
function toggleMark(pid, role) {
  if (marks.value[pid] === role) delete marks.value[pid];
  else marks.value[pid] = role;
  saveMarks();
}
function clearMark(pid) {
  delete marks.value[pid];
  saveMarks();
}
// 终局对比：角色标记与真实身份（含变身前原身份）任一匹配即命中；阵营标记与真实阵营匹配即命中
function markHit(p) {
  const roles = d.value.roles;
  const mark = marks.value[p.id];
  if (!roles || !mark) return false;
  const real = roles.find((r) => r.name === p.name);
  if (!real) return false;
  if (CAMP_MARKS.includes(mark)) {
    return campOfRole(real.role) === mark || (real.roleBackup && campOfRole(real.roleBackup) === mark);
  }
  return real.role === mark || (real.roleBackup && real.roleBackup === mark);
}
watch(() => state.gameId, loadMarks, { immediate: true });

const d = computed(() => state.deduction || {});
const phase = computed(() => d.value.phase || 'day');
// —— 昼夜主题：白天暖色 / 夜晚结算深蓝，1.5s 平滑渐变 ——
// 夜幕时刻：处刑确认后到天亮弹窗关闭前（execResult 或 nightEvent 显示中）
const isNightTheme = computed(() => {
  if (state.gameOver) return false;
  return !!execResult.value || !!nightEvent.value;
});
const disabled = computed(() => state.loading || state.gameOver);
const canAdjudicate = computed(() => !!d.value.canAdjudicate && !disabled.value);
const canListen = computed(() => phase.value === 'day' && !state.gameOver && !state.loading);

const PHASE_TEXT = {
  day: '白天·听取发言',
  adjudicate: '裁决阶段',
  win: '好人获胜',
  lose: '狼人获胜',
};

// 角色能力说明（基于当前实现，法官可见的规则卡）
const ADV_NEW_ROLES = ['观者', '邮差', '行者', '庸医', '间谍', '小丑', '术士'];
const ROLE_DECK = [
  {
    group: '好人阵营',
    roles: [
      { name: '文员', desc: '不出门。开局即知道「本局存在的角色名单」，并在发言中公布（不含对应关系）。后续无夜晚技能。' },
      { name: '侦探', desc: '每夜出门探访一人，获得线索：「目标曾外出活动 / 没有外出活动」。' },
      { name: '村民', desc: '不出门、无技能。若有其他角色来拜访，会知道「有人来过」（被小偷清除记忆则只说忘记了）。' },
      { name: '法医', desc: '第一夜不出门。从第二夜起出门前往上一案发现场，并在下个白天公布死者真实身份。' },
      { name: '守卫', desc: '每夜出门拜访一人进行保护。若该人被狼袭击则狼刀被挡下（平安夜）。可自保；不能连续两夜保护同一人。' },
      { name: '观者', desc: '不出门。每夜观测一人，得知其阵营（好人/中立/坏人），但无法得知具体身份。' },
      { name: '邮差', desc: '出门。每夜拜访一人送信：若自身本夜不是狼人目标，技能无任何作用；若自身是狼人目标——拜访对象为好人则狼人空刀且邮差得知自己是目标，拜访对象为坏人/中立则正常被刀。' },
      { name: '行者', desc: '出门。每夜拜访一人：若对方是好人或中立，则知晓其具体身份；若对方是坏人，则与其同归于尽。' },
    ],
  },
  {
    group: '中立阵营',
    roles: [
      { name: '赌徒', desc: '不出门。每夜猜测一人是「好人/中立/坏人」：猜对则获得其阵营信息；猜错立即死亡。' },
      { name: '小偷', desc: '每夜出门拜访一人。若目标本夜死亡则获得其原本行动的情报（如守卫守了谁、侦探探到什么），不继承行动能力；若目标存活则清除其本夜记忆（对方技能无效，发言只剩「忘记了」）；拜访到狼人会让狼人本夜刀无效（狼人记忆不受影响）。' },
      { name: '庸医', desc: '不出门。每夜若有拜访者则给药：拜访者本夜将要死去则免于死亡，否则拜访者死亡。' },
      { name: '间谍', desc: '出门。每夜拜访一人：若对方是好人，明日如实发言；若对方是坏人或中立，明日撒谎。' },
    ],
  },
  {
    group: '坏人阵营',
    roles: [
      { name: '狼人', desc: '每夜出门刀杀一人，可杀任何人（即使对方在家）。首夜不能刀文员。死后由仍存活的坏人阵营继承狼人身份。' },
      { name: '帮凶', desc: '每夜出门拜访一人（可扰乱视线）。知道狼人是谁，可为其掩护或栽赃他人。狼人死后接任狼人。' },
      { name: '酒鬼', desc: '不出门，待在家中喝酒。拜访他的人会被迷醉（本夜技能无效，发言只剩「忘记了」）。狼人死后接任狼人。' },
      { name: '小丑', desc: '出门。每夜拜访一人（仅好人/中立），扭曲其记忆，使其明日发言颠倒关键信息。狼人死后接任狼人。' },
      { name: '术士', desc: '不出门。每夜链接两人命运（仅好人/中立）：被链接的两人中若有人今夜死亡，另一人同时死亡。狼人死后接任狼人。' },
    ],
  },
];
// 角色卡「本局」标记：只有文员已公布名单后才高亮本局存在的角色
const clerkPoolRevealed = computed(() => !!d.value.clerkPoolRevealed);
const hasRole = (name) => clerkPoolRevealed.value && (d.value.roles || []).some(r => r.role === name);

// 自称身份速记：检测冲突（两人声称同一身份）
const claimConflicts = computed(() => {
  const claims = d.value.claims || [];
  const map = {};
  for (const c of claims) {
    if (!c.claimed) continue;
    (map[c.claimed] = map[c.claimed] || []).push(c.name);
  }
  const conflicts = {};
  for (const [role, names] of Object.entries(map)) {
    if (names.length > 1) conflicts[role] = names;
  }
  return conflicts;
});

function isConflict(name) {
  for (const names of Object.values(claimConflicts.value)) {
    if (names.includes(name)) return true;
  }
  return false;
}

// 终局逐夜行动回顾
const nightLogs = computed(() => d.value.nightLogs || []);

const deckGroups = computed(() =>
  ROLE_DECK
    .map((g) => ({ ...g, roles: g.roles.filter((r) => d.value.board === 'advanced' || !ADV_NEW_ROLES.includes(r.name)) }))
    .filter((g) => g.roles.length)
);
// 与原对话消息中「逐夜行动回顾」完全一致的表述（已从对话迁移至此）
function formatNightLog(l) {
  const line = [];
  if (l.wolf) {
    const wft = l.wolf.who || '狼人';
    line.push(l.wolf.killed ? `${wft}（狼）刀杀「${l.wolf.killed}」` : l.wolf.blocked ? `${wft}（狼）袭击「${l.wolf.target}」但被守卫挡下` : `${wft}（狼）未刀任何人`);
  }
  if (l.accomplice) line.push(`${l.accomplice.who}（帮凶）拜访「${l.accomplice.target}」`);
  if (l.guard) {
    const g = l.guard;
    line.push(g.effective && l.wolf && l.wolf.blocked
      ? `${g.who}（守卫）保护「${g.target}」，成功挡下狼刀`
      : `${g.who}（守卫）守护「${g.target}」，平安无事`);
  }
  if (l.detective) line.push(`${l.detective.who}（侦探）探访「${l.detective.target}」，结论：该人昨夜${l.detective.clue}`);
  if (l.forensics && l.forensics.role) line.push(`${l.forensics.who}（法医）鉴定上一夜死者「${l.forensics.target}」的身份为${l.forensics.role}`);
  else if (l.forensics && !l.forensics.role) line.push(`${l.forensics.who}（法医）此前无新尸体可检`);
  if (l.thief) line.push(`${l.thief.who}（小偷）拜访「${l.thief.target}」：${l.thief.effect || '行动未生效'}`);
  if (l.gambler) {
    const g = l.gambler;
    if (g.forgot) line.push(`${g.who}（赌徒）本欲猜测「${g.target}」但被清除记忆，未能行动`);
    else line.push(`${g.who}（赌徒）猜「${g.target}」为${g.claim}（${g.correct ? '正确' : '错误'}${g.died ? '，赌徒不幸殒命' : '，安然无恙'}）`);
  }
  if (l.drunkard && l.drunkard.affected && l.drunkard.affected.length) line.push(`${l.drunkard.who}（酒鬼）迷醉了${l.drunkard.affected.join('、')}`);
  if (l.watcher) line.push(`${l.watcher.who}（观者）观测「${l.watcher.target}」，阵营为${l.watcher.camp}`);
  if (l.postman) line.push(l.postman.saved ? `${l.postman.who}（邮差）送信给「${l.postman.target}」时察觉杀机——狼人空刀` : `${l.postman.who}（邮差）给「${l.postman.target}」送信，无事发生`);
  if (l.walker) line.push(l.walker.kill ? `${l.walker.who}（行者）拜访「${l.walker.target}」——对方是坏人，同归于尽` : `${l.walker.who}（行者）拜访「${l.walker.target}」，探明其身份`);
  if (l.spy) line.push(`${l.spy.who}（间谍）拜访「${l.spy.target}」，明日将${l.spy.lie ? '撒谎' : '如实发言'}`);
  if (l.clown) line.push(`${l.clown.who}（小丑）扭曲了「${l.clown.target}」的记忆`);
  if (l.warlock) line.push(`${l.warlock.who}（术士）链接了「${l.warlock.links[0]}」与「${l.warlock.links[1]}」的命运${l.warlock.chain && l.warlock.chain.length ? `，连锁带走了${l.warlock.chain.join('、')}` : ''}`);
  if (l.quack) {
    const q = l.quack;
    if (q.saves && q.saves.length) line.push(`${q.who}（庸医）救下了${q.saves.join('、')}`);
    if (q.poisons && q.poisons.length) line.push(`${q.who}（庸医）的药毒杀了${q.poisons.join('、')}`);
  }
  if (l.forgotten && l.forgotten.length) line.push(`被清除记忆：${l.forgotten.join('、')}`);
  if (l.deaths && l.deaths.length) line.push(`本夜逝去：${l.deaths.join('、')}`);
  return line.join('；');
}

const isAdvanced = computed(() => d.value.board === 'advanced');
const execPicks = ref([]); // 十人局：勾选的处决目标（最多 2 人）
const showNightReview = ref(false); // 终局：逐夜行动回顾浮层

// —— 裁决浮层：裁决阶段按需弹出，避免面板常驻占用对话空间 ——
const showAdjudicate = ref(false);
watch(canAdjudicate, (v) => { if (!v) showAdjudicate.value = false; });
watch(() => state.gameId, () => { showAdjudicate.value = false; });

// —— 手机端按天翻页：每天的角色对话独占一页，左右滑动/点按切换 ——
const isMobile = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(max-width: 768px)');
  const onMq = (e) => { isMobile.value = e.matches; };
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  else if (mq.addListener) mq.addListener(onMq);
}
const curDay = ref(1);
const lastDay = computed(() => (dayGroups.value.length ? dayGroups.value[dayGroups.value.length - 1].day : 1));
watch(dayGroups, (gs, old) => {
  if (!gs.length) return;
  // 仅当用户正停留在最新一天时自动跟随；翻看历史页时不打断
  const prevLast = old && old.length ? old[old.length - 1].day : 0;
  if (!old || curDay.value >= prevLast) curDay.value = gs[gs.length - 1].day;
}, { immediate: true });
const displayGroups = computed(() => (isMobile.value ? dayGroups.value.filter((g) => g.day === curDay.value) : dayGroups.value));
function prevDay() { if (curDay.value > 1) curDay.value -= 1; }
function nextDay() { if (curDay.value < lastDay.value) curDay.value += 1; }
let pageTouchX = 0;
function onPageTouchStart(e) { pageTouchX = e.changedTouches[0].clientX; }
function onPageTouchEnd(e) {
  const dx = e.changedTouches[0].clientX - pageTouchX;
  if (Math.abs(dx) > 50) (dx < 0 ? nextDay() : prevDay());
}

// —— 每夜事件弹窗：新的一天开始时提示昨夜实际发生的事情（死讯/平安夜） ——
// 时序：若处刑结果弹窗正在显示，先暂存，待其关闭后再弹出（处刑结果 → 夜间事件）
const nightEvent = ref(null);
let lastSeenRound = 0;
let pendingNightEvent = null;

// —— 终局结算弹窗（时序：处刑结果弹窗显示期间暂存，关闭后再弹出） ——
const showEndModal = ref(false);
// 终局海报：资产合成（背景+存活人物剪影），秒出零成本——游戏结束自动显示
const endingArt = ref('');
watch(() => state.gameOver, async (v) => {
  if (!v || !state.gameId) { endingArt.value = ''; portraits.value = {}; return; }
  try {
    const r = await api.endingArt(state.gameId);
    if (r && r.b64) endingArt.value = `data:image/png;base64,${r.b64}`;
  } catch (e) { /* 失败静默 */ }
}, { immediate: true });
// 角色立绘：终局谢幕卡片点击按需生成（控制成本），生成后替换卡片徽章；带缓存
const portraits = ref({});
const portraitLoading = ref({}); // 加载中标记（响应式，模板显示 …）
let portraitDisabled = false; // 服务端未配置图像模型时置位，避免反复无效请求
async function loadPortrait(name) {
  if (portraitDisabled || portraitLoading.value[name] || portraits.value[name] || !state.gameId) return;
  portraitLoading.value = { ...portraitLoading.value, [name]: true };
  try {
    const r = await api.portrait(state.gameId, name);
    if (r && r.b64) portraits.value = { ...portraits.value, [name]: `data:image/png;base64,${r.b64}` };
    else if (r && r.disabled) portraitDisabled = true;
  } catch (e) { /* 失败静默 */ }
  const next = { ...portraitLoading.value };
  delete next[name];
  portraitLoading.value = next;
}
// 终局弹窗打开时自动加载全部角色立绘（资产读取秒出、零成本，无需逐个点击）
let pendingEndModal = false;
watch(() => state.gameOver, (v) => {
  if (!v) { showEndModal.value = false; pendingEndModal = false; return; }
  // 游戏结束瞬间即预取全部立绘（与终局插画并行）——弹窗打开时立绘已就绪，无需等待
  if (!portraitDisabled) for (const r of d.value.roles || []) loadPortrait(r.name);
  if (execResult.value) pendingEndModal = true;
  else showEndModal.value = true;
}, { immediate: true });
// 换局重置弹窗状态
watch(() => state.gameId, () => { lastSeenRound = 0; nightEvent.value = null; pendingNightEvent = null; pendingEndModal = false; });
function togglePick(id) {
  const i = execPicks.value.indexOf(id);
  if (i >= 0) execPicks.value.splice(i, 1);
  else if (execPicks.value.length < 2) execPicks.value.push(id);
}
// —— 处刑结果弹窗：处刑/放弃后解析叙事，以黑夜弹窗同风格展示 ——
const execResult = ref(null);
let pendingExec = false;
// 处刑仪式感：法槌落下瞬间的全屏闪白 + 界面震动
const gavelFlash = ref(false);
function triggerGavelFlash() {
  gavelFlash.value = true;
  setTimeout(() => { gavelFlash.value = false; }, 600);
}
function watchExecResult() {
  if (!pendingExec) return;
  const hist = state.history || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const c = String(hist[i].content || '');
    if (c.includes('你举起法槌') || c.includes('决定【放弃处刑】')) {
      pendingExec = false;
      if (c.includes('决定【放弃处刑】')) {
        execResult.value = { pass: true };
      } else {
        const targets = [];
        const re = /「([^」]+)」被带下去，身份牌翻开——【([^】]+)】！(.*)/g;
        let m;
        while ((m = re.exec(c)) !== null) targets.push({ name: m[1], role: m[2], verdict: m[3].trim() });
        execResult.value = { pass: false, multi: c.includes('下令处决两人'), targets };
        triggerGavelFlash(); // 法槌落下：全屏闪白 + 界面震动
      }
      return;
    }
    if (c.includes('天亮了')) break;
  }
}
watch(() => (state.history || []).length, watchExecResult, { immediate: false });

// 处刑结果弹窗关闭后，再显示暂存的夜间事件弹窗与终局结算弹窗
// 华丽化：夜间事件前先播放 2.5s 夜晚过场动画（黑幕→行动剪影→天光）
const nightTransition = ref(false);
watch(execResult, (v) => {
  if (!v) {
    if (pendingNightEvent) {
      const evt = pendingNightEvent;
      pendingNightEvent = null;
      nightTransition.value = true; // 播放过场
      setTimeout(() => {
        nightTransition.value = false;
        nightEvent.value = evt; // 过场结束弹出天亮弹窗
      }, 2500);
    }
    if (pendingEndModal) {
      showEndModal.value = true;
      pendingEndModal = false;
    }
  }
});
// 夜间事件监听（注册于处刑结果之后，确保同批次更新时处刑结果先落定）
// 注意：数据更新顺序为『游戏状态先、历史消息后』，而处刑结果从历史消息解析，
// 因此此处用 nextTick 延后到全部数据落定后再判断，避免暂存判断失效导致抢先弹出。
watch(() => [d.value.round, d.value.phase, state.gameOver], () => {
  if (state.gameOver) return;
  const r = d.value.round || 1;
  if (r !== lastSeenRound && (d.value.phase === 'day' || d.value.phase === 'adjudicate')) {
    lastSeenRound = r;
    const deaths = (d.value.deaths || []).filter((x) => x.round === r && x.cause === 'night');
    const evt = { round: r, deaths: deaths.map((x) => x.name), peaceful: !deaths.length };
    nextTick(() => {
      if (execResult.value) pendingNightEvent = evt; // 处刑结果弹窗显示中 → 暂存
      else nightEvent.value = evt;
    });
  }
}, { immediate: true });

function doExecute(targetId) {
  if (isAdvanced.value) {
    if (!execPicks.value.length) return;
    const names = execPicks.value
      .map((id) => (d.value.players || []).find((x) => x.id === id)?.name)
      .filter(Boolean)
      .join('」与「');
    const sure = window.confirm(`确定处刑「${names}」吗？处刑会公开其真实身份牌，若误伤好人将损失好人。`);
    if (!sure) return;
    pendingExec = true;
    adjudicateTarget(execPicks.value.slice());
    execPicks.value = [];
    return;
  }
  const p = (d.value.players || []).find((x) => x.id === targetId);
  const sure = window.confirm(`确定处刑「${p?.name || ''}」吗？处刑会公开其真实身份牌，若误伤好人将损失一名好人。`);
  if (!sure) return;
  pendingExec = true;
  adjudicateTarget(targetId);
}

function doPass() {
  const sure = window.confirm('确定放弃处刑吗？今天无人被放逐，直接进入下一夜。');
  if (!sure) return;
  pendingExec = true;
  adjudicateTarget('');
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

onMounted(scrollToBottom);
watch(() => state.history.length, scrollToBottom);
</script>

<template>
  <div class="game" :class="{ 'drawer-open': drawer, 'theme-night': isNightTheme, 'theme-day': !isNightTheme && !state.gameOver }">
    <!-- 昼夜主题：星星粒子背景层（夜晚显示） -->
    <div v-if="isNightTheme" class="night-particles" aria-hidden="true">
      <span v-for="s in 24" :key="s" class="np-star" :style="{ left: ((s * 41) % 100) + '%', top: ((s * 29) % 90) + '%', animationDelay: (s * 0.23) + 's', animationDuration: (1.8 + (s % 5) * 0.5) + 's' }"></span>
    </div>
    <!-- 左侧：法官状态 + 存活玩家 + 死讯 -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>⚖️ {{ state.player?.name }}</h2>
      </div>

      <div class="phase-badge" :key="phase" :class="phase">{{ PHASE_TEXT[phase] || phase }}</div>

      <div class="judge-hint">
        <span class="muted">你是法官——不参与游戏，只听发言、裁决处刑。</span>
      </div>

      <div class="stat-row">
        <span>第 {{ d.round || 1 }} 天</span>
        <span>存活 {{ d.aliveCount || 0 }}/{{ (d.players || []).length }}</span>
      </div>

      <!-- 角色卡（可展开） -->
      <div id="sec-roles" class="roledeck">
        <button class="deck-toggle" @click="showRoles = !showRoles">
          📖 角色能力说明 {{ showRoles ? '▲' : '▼' }}
        </button>
        <div v-if="showRoles" class="deck-body">
          <div v-for="g in deckGroups" :key="g.group" class="deck-group">
            <div class="deck-group-label">{{ g.group }}</div>
            <div
              v-for="r in g.roles"
              :key="r.name"
              class="deck-role"
              :class="{ inalive: hasRole(r.name) }"
            >
              <div class="deck-role-head">
                <b>{{ r.name }}</b>
                <span v-if="hasRole(r.name)" class="in-tag">本局</span>
              </div>
              <p class="deck-desc">{{ r.desc }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 自称身份速记 -->
      <div v-if="(d.claims || []).length" id="sec-claims" class="claims">
        <h3>自称身份</h3>
        <div v-for="c in d.claims" :key="c.playerId" class="claim-row" :class="{ conflict: isConflict(c.name) }">
          <span class="claim-name">{{ c.name }}</span>
          <b class="claim-role">{{ c.claimed || '未声明' }}</b>
        </div>
        <div v-if="Object.keys(claimConflicts).length" class="conflict-hint">
          <span v-for="(names, role) in claimConflicts" :key="role" class="conflict-tag">
            {{ role }}：{{ names.join(' vs ') }}
          </span>
        </div>
      </div>

      <!-- 玩家列表 -->
      <div id="sec-players" class="players">
        <h3>在场者</h3>
        <div
          v-for="p in d.players || []"
          :key="p.id"
          class="player-row"
          :class="{ dead: !p.alive }"
        >
          <span class="player-name" title="点击标记你推测的身份" @click="markOpenId = markOpenId === p.id ? '' : p.id">
            {{ p.name }}<span v-if="marks[p.id]" class="player-mark" :class="[markClass(marks[p.id]), d.roles ? (markHit(p) ? 'hit' : 'miss') : '']">{{ marks[p.id] }}{{ d.roles ? (markHit(p) ? ' ✓' : ' ✗') : '' }}</span>
          </span>
          <button
            class="mark-toggle"
            :class="{ active: markOpenId === p.id, marked: !!marks[p.id] }"
            :title="marks[p.id] ? '修改「' + p.name + '」的标记' : '标记「' + p.name + '」推测的身份'"
            @click="markOpenId = markOpenId === p.id ? '' : p.id"
          >🏷 {{ marks[p.id] ? '已标记' : '标记' }}</button>
          <span class="player-status">{{ p.alive ? '存活' : '出局' }}</span>
        </div>
        <!-- 标记选择面板：点击玩家名展开 -->
        <div v-if="markOpenId" class="mark-panel">
          <div class="mark-row">
            <span class="mark-row-label">阵营</span>
            <button
              v-for="c in CAMP_MARKS"
              :key="c"
              class="mark-btn"
              :class="[markClass(c), { active: marks[markOpenId] === c }]"
              @click="toggleMark(markOpenId, c)"
            >{{ c }}</button>
          </div>
          <div class="mark-row">
            <span class="mark-row-label">角色</span>
            <button
              v-for="r in ALL_ROLES"
              :key="r"
              class="mark-btn"
              :class="[markClass(r), { active: marks[markOpenId] === r }]"
              @click="toggleMark(markOpenId, r)"
            >{{ r }}</button>
          </div>
          <button class="mark-btn clear" @click="clearMark(markOpenId); markOpenId = ''">清除</button>
        </div>
      </div>

      <!-- 死讯（默认折叠，显示最近两条） -->
      <div v-if="(d.deaths || []).length" class="deaths">
        <button class="day-toggle" @click="showAllDeaths = !showAllDeaths">
          ⚰️ 死讯记录 <span class="day-count">（共 {{ d.deaths.length }} 条）</span> {{ showAllDeaths ? '▲' : '▼' }}
        </button>
        <div v-if="showAllDeaths" class="death-list">
          <div v-for="(dd, i) in d.deaths" :key="i" class="death-row">
            <span class="death-round">第{{ dd.round }}天</span>
            <span class="death-name">{{ dd.name }}</span>
            <span class="death-cause">{{ dd.cause === 'execute' ? '被处刑' : '夜里遇害' }}</span>
            <b v-if="dd.role" :class="roleClass(dd.role)">{{ dd.role }}</b>
          </div>
        </div>
        <div v-else class="death-list">
          <div v-for="(dd, i) in d.deaths.slice(-2)" :key="i" class="death-row">
            <span class="death-round">第{{ dd.round }}天</span>
            <span class="death-name">{{ dd.name }}</span>
            <span class="death-cause">{{ dd.cause === 'execute' ? '被处刑' : '夜里遇害' }}</span>
            <b v-if="dd.role" :class="roleClass(dd.role)">{{ dd.role }}</b>
          </div>
        </div>
      </div>

      <!-- 身份复盘（游戏结束） -->
      <div v-if="d.roles" class="reveal">
        <h3>身份复盘</h3>
        <div v-for="(r, i) in d.roles" :key="i" class="reveal-row">
          <span>{{ r.name }}</span>
          <b :class="roleClass(r.roleBackup || r.role)">{{ r.roleBackup || r.role }}<span v-if="r.roleBackup" class="reveal-turned">（第{{ r.turnedRound || '?' }}夜变身狼人）</span></b>
        </div>
      </div>

      <!-- 逐夜行动回顾（游戏结束） -->
      <button v-if="state.gameOver" class="btn primary full" @click="restart">再开一局</button>
    </aside>

    <!-- 回到底部悬浮按钮：滚动距底部超一屏时浮现 -->
    <button v-if="showBackBottom" class="back-bottom" @click="scrollToLatest">↓ 最新</button>

    <!-- 移动端：吸顶摘要条（天数/存活/阶段，随时可见） -->
    <div class="mobile-summary">
      <span>第 {{ d.round || 1 }} 天</span>
      <span>存活 {{ d.aliveCount || 0 }}/{{ (d.players || []).length }}</span>
      <span class="ms-phase">{{ PHASE_TEXT[phase] || phase }}</span>
    </div>

    <!-- 移动端：底部悬浮工具栏（打开覆盖式抽屉，页面不滚动） -->
    <nav class="mobile-dock">
      <button :class="{ on: drawer === 'status' }" @click="openDrawer('status')">⚖️ 状态</button>
      <button :class="{ on: drawer === 'players' }" @click="openDrawer('players')">👥 在场者</button>
      <button :class="{ on: drawer === 'claims' }" @click="openDrawer('claims')">🗣 自称身份</button>
      <button :class="{ on: drawer === 'roles' }" @click="openDrawer('roles')">📖 角色说明</button>
    </nav>

    <!-- 移动端：底部抽屉（覆盖层，关闭后阅读位置不变） -->
    <Transition name="drw">
      <div v-if="drawer" class="drawer-mask" @click="closeDrawer"></div>
    </Transition>
    <Transition name="drw">
    <div v-if="drawer" class="drawer-panel">
      <div class="drawer-head">
        <h3>{{ drawer === 'players' ? '在场者' : drawer === 'claims' ? '自称身份' : drawer === 'roles' ? '角色能力说明' : '法官状态' }}</h3>
        <button class="drawer-close" @click="closeDrawer">收起 ▼</button>
      </div>
      <div class="drawer-body">
        <!-- 在场者（含标记功能） -->
        <template v-if="drawer === 'players'">
          <div
            v-for="p in d.players || []"
            :key="p.id"
            class="player-row"
            :class="{ dead: !p.alive }"
          >
            <span class="player-name" title="点击标记你推测的身份" @click="markOpenId = markOpenId === p.id ? '' : p.id">
              {{ p.name }}<span v-if="marks[p.id]" class="player-mark" :class="[markClass(marks[p.id]), d.roles ? (markHit(p) ? 'hit' : 'miss') : '']">{{ marks[p.id] }}{{ d.roles ? (markHit(p) ? ' ✓' : ' ✗') : '' }}</span>
            </span>
            <button
              class="mark-toggle"
              :class="{ active: markOpenId === p.id, marked: !!marks[p.id] }"
              @click="markOpenId = markOpenId === p.id ? '' : p.id"
            >🏷 {{ marks[p.id] ? '已标记' : '标记' }}</button>
            <span class="player-status">{{ p.alive ? '存活' : '出局' }}</span>
          </div>
          <div v-if="markOpenId" class="mark-panel">
            <div class="mark-row">
              <span class="mark-row-label">阵营</span>
              <button
                v-for="c in CAMP_MARKS"
                :key="c"
                class="mark-btn"
                :class="[markClass(c), { active: marks[markOpenId] === c }]"
                @click="toggleMark(markOpenId, c)"
              >{{ c }}</button>
            </div>
            <div class="mark-row">
              <span class="mark-row-label">角色</span>
              <button
                v-for="r in ALL_ROLES"
                :key="r"
                class="mark-btn"
                :class="[markClass(r), { active: marks[markOpenId] === r }]"
                @click="toggleMark(markOpenId, r)"
              >{{ r }}</button>
            </div>
            <button class="mark-btn clear" @click="clearMark(markOpenId); markOpenId = ''">清除</button>
          </div>
        </template>
        <!-- 自称身份 -->
        <template v-else-if="drawer === 'claims'">
          <div v-for="c in d.claims || []" :key="c.playerId" class="claim-row" :class="{ conflict: isConflict(c.name) }">
            <span class="claim-name">{{ c.name }}</span>
            <b class="claim-role">{{ c.claimed || '未声明' }}</b>
          </div>
          <div v-if="Object.keys(claimConflicts).length" class="conflict-hint">
            <span v-for="(names, role) in claimConflicts" :key="role" class="conflict-tag">
              {{ role }}：{{ names.join(' vs ') }}
            </span>
          </div>
          <p v-if="!(d.claims || []).length" class="drawer-empty">暂无人声明身份</p>
        </template>
        <!-- 角色能力说明 -->
        <template v-else-if="drawer === 'roles'">
          <div v-for="g in deckGroups" :key="g.group" class="deck-group">
            <div class="deck-group-label">{{ g.group }}</div>
            <div
              v-for="r in g.roles"
              :key="r.name"
              class="deck-role"
              :class="{ inalive: hasRole(r.name) }"
            >
              <div class="deck-role-head">
                <b>{{ r.name }}</b>
                <span v-if="hasRole(r.name)" class="in-tag">本局</span>
              </div>
              <p class="deck-desc">{{ r.desc }}</p>
            </div>
          </div>
        </template>
        <!-- 法官状态 / 死讯 / 复盘（移动端单屏布局：侧栏内容收进抽屉） -->
        <template v-else>
          <div class="phase-badge" :key="phase" :class="phase">{{ PHASE_TEXT[phase] || phase }}</div>
          <div class="stat-row">
            <span>第 {{ d.round || 1 }} 天</span>
            <span>存活 {{ d.aliveCount || 0 }}/{{ (d.players || []).length }}</span>
          </div>
          <div v-if="(d.deaths || []).length" class="death-list">
            <div v-for="(dd, i) in d.deaths" :key="i" class="death-row">
              <span class="death-round">第{{ dd.round }}天</span>
              <span class="death-name">{{ dd.name }}</span>
              <span class="death-cause">{{ dd.cause === 'execute' ? '被处刑' : '夜里遇害' }}</span>
              <b v-if="dd.role" :class="roleClass(dd.role)">{{ dd.role }}</b>
            </div>
          </div>
          <div v-if="d.roles" class="reveal">
            <h3>身份复盘</h3>
            <div v-for="(r, i) in d.roles" :key="i" class="reveal-row">
              <span>{{ r.name }}</span>
              <b :class="roleClass(r.roleBackup || r.role)">{{ r.roleBackup || r.role }}<span v-if="r.roleBackup" class="reveal-turned">（第{{ r.turnedRound || '?' }}夜变身狼人）</span></b>
            </div>
          </div>
          <button v-if="state.gameOver" class="btn primary full" @click="restart">再开一局</button>
        </template>
      </div>
    </div>
    </Transition>

    <!-- 主区：发言流 + 裁决面板 -->
    <main class="main-panel">
      <div class="messages" ref="messagesEl" @scroll="onMessagesScroll" @touchstart="isMobile ? onPageTouchStart($event) : null" @touchend="isMobile ? onPageTouchEnd($event) : null">
        <!-- 手机端：按天翻页指示条 -->
        <div v-if="isMobile && lastDay > 1" class="day-pager">
          <button class="pager-btn" :disabled="curDay <= 1" @click="prevDay">‹</button>
          <span class="pager-indicator">第 {{ curDay }} / {{ lastDay }} 天</span>
          <button class="pager-btn" :disabled="curDay >= lastDay" @click="nextDay">›</button>
        </div>
        <div v-for="g in displayGroups" :key="g.day" class="day-group">
          <div class="day-header">📅 第 {{ g.day }} 天 <span class="day-count">（{{ g.msgs.length }} 条）</span></div>
          <div>
            <div
              v-for="(msg, i) in g.msgs"
              :key="g.day + '-' + i"
              class="msg assistant msg-card"
              :class="{ 'msg-dead': parseSpeaker(msg.content) && isDeadName(parseSpeaker(msg.content).name), 'msg-executed': parseSpeaker(msg.content) && isExecutedName(parseSpeaker(msg.content).name), [campClassOfName(parseSpeaker(msg.content)?.name)]: parseSpeaker(msg.content) }"
              :style="parseSpeaker(msg.content) ? { '--pc': playerColor(parseSpeaker(msg.content).name) } : {}"
            >
              <div class="msg-content">
                <template v-if="parseSpeaker(msg.content)">
                  <span class="msg-avatar" :style="{ background: playerColor(parseSpeaker(msg.content).name) }">{{ parseSpeaker(msg.content).name.slice(0, 1) }}</span>
                  <span class="speaker" :style="{ color: playerColor(parseSpeaker(msg.content).name) }">「{{ parseSpeaker(msg.content).name }}」：</span><template v-for="(seg, j) in parseSpeech(parseSpeaker(msg.content).rest)" :key="j"><span v-if="seg.cls" :class="seg.cls">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template><span v-if="claimConflictsOf(parseSpeaker(msg.content).name).length" class="conflict-flag" :title="'与 ' + claimConflictsOf(parseSpeaker(msg.content).name).join('、') + ' 身份对跳'">⚠ 对跳</span>
                </template>
                <template v-else>
                  <template v-for="(seg, j) in parseSpeech(msg.content)" :key="j"><span v-if="seg.cls" :class="seg.cls">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template>
                </template>
              </div>
            </div>
          </div>
        </div>
        <div v-if="state.loading" class="msg assistant">
          <div class="msg-content loading-text">大家正在发言…</div>
        </div>
      </div>

      <div v-if="state.error" class="error-bar">{{ state.error }}</div>

      <!-- 白天：听取发言（法官无需输入文字） -->
      <div v-else-if="canListen" class="listen-bar">
        <button class="btn listen-btn" :disabled="disabled" @click="listenSpeeches">
          {{ state.loading ? '正在听取发言…' : '🗣️ 听取所有存活者发言' }}
        </button>
        <p class="listen-hint">{{ state.loading ? '大家正在依次陈述，约需 10~20 秒，请稍候…' : '法官无需发言，点击按钮即可听取在场所有人的陈述。' }}</p>
      </div>

      <!-- 裁决阶段：按需弹出（避免面板常驻占用对话空间） -->
      <div v-else-if="canAdjudicate" class="adjudicate-entry">
        <button class="btn primary" :disabled="disabled" @click="showAdjudicate = true">⚔️ 现在由你裁决</button>
      </div>

      <div v-else-if="state.gameOver" class="end-bar">
        <p class="end-text">{{ d.winner === 'good' ? '🌅 狼人全部落网，好人获胜！' : '🐺 狼人潜伏到最后，好人失败…' }}</p>
        <button class="btn review-btn" @click="showEndModal = true">📜 查看结算</button>
      </div>
    </main>

    <!-- 裁决浮层：点击『现在由你裁决』后弹出 -->
    <Transition name="ovl">
    <div v-if="showAdjudicate && canAdjudicate" class="review-overlay" @click.self="showAdjudicate = false">
      <div class="review-modal adjudicate-modal">
        <div class="review-head">
          <h3>⚔️ 现在由你裁决</h3>
          <button class="review-close" @click="showAdjudicate = false">✕</button>
        </div>
        <div class="review-body">
          <p class="adjudicate-hint">处刑某位存活者会公开其真实身份牌；或放弃处刑直接进入下一夜。</p>
          <div class="vote-list">
            <button
              v-for="p in (d.players || []).filter((x) => x.alive)"
              :key="p.id"
              class="execute-btn"
              :class="{ picked: isAdvanced && execPicks.includes(p.id) }"
              :disabled="disabled || (isAdvanced && !execPicks.includes(p.id) && execPicks.length >= 2)"
              @click="isAdvanced ? togglePick(p.id) : doExecute(p.id)"
            >
              {{ isAdvanced ? (execPicks.includes(p.id) ? '✅ 已选 ' : '☐ 勾选 ') : '⚔️ 处刑 ' }}{{ p.name }}
            </button>
          </div>
          <button v-if="isAdvanced" class="pass-btn" :disabled="disabled || !execPicks.length" @click="doExecute()">
            ⚔️ 处决选中的 {{ execPicks.length }} 人
          </button>
          <button class="pass-btn" :disabled="disabled" @click="doPass">🛡️ 放弃处刑（进入下一夜）</button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- 处刑结果弹窗：法槌落下，身份牌揭开（按阵营着色） -->
    <Transition name="ovl">
    <div v-if="execResult" class="review-overlay" @click.self="execResult = null">
      <div class="review-modal exec-modal">
        <div v-if="execResult.pass" class="exec-gavel pass">🛡️</div>
        <div v-else class="exec-gavel" :class="execResult.multi ? 'multi' : ''">🔨</div>
        <h3 class="exec-title">{{ execResult.pass ? '放弃处刑' : execResult.multi ? '处决两人' : '处刑' }}</h3>
        <p v-if="execResult.pass" class="exec-text">你权衡再三，决定【放弃处刑】——证据还不够充分，贸然出手可能误伤好人。今天没有人被放逐，直接进入下一夜。</p>
        <template v-else>
          <p class="exec-text">你举起法槌{{ execResult.multi ? '，接连指向' : '，指向' }}<span v-for="(t, i) in execResult.targets" :key="t.name">{{ i > 0 ? '与' : '' }}「{{ t.name }}」</span>，下令{{ execResult.multi ? '处决' : '处刑' }}。</p>
          <div v-for="(t, i) in execResult.targets" :key="t.name" class="exec-card" :style="{ animationDelay: (0.5 + i * 0.4) + 's' }">
            <span class="exec-name">「{{ t.name }}」被带下去，身份牌翻开——</span>
            <div class="exec-flip">
              <div class="exec-flip-inner">
                <div class="exec-flip-back">？</div>
                <div class="exec-flip-front"><b :class="roleClass(t.role)" class="exec-role">【{{ t.role }}】</b></div>
              </div>
            </div>
            <span v-if="t.verdict" class="exec-verdict">{{ t.verdict }}</span>
          </div>
        </template>
        <button class="btn primary" @click="execResult = null">知道了</button>
      </div>
    </div>
    </Transition>

    <!-- 处刑仪式感：法槌落下瞬间的全屏闪白 -->
    <div v-if="gavelFlash" class="gavel-flash" aria-hidden="true"></div>

    <!-- 夜晚结算过场：黑幕降临 → 行动剪影掠过 → 天光渐亮（不剧透具体内容） -->
    <Transition name="ovl">
      <div v-if="nightTransition" class="night-transition">
        <div class="nt-silhouettes" aria-hidden="true">
          <span class="nt-icon" style="animation-delay: 0.3s">🗡️</span>
          <span class="nt-icon" style="animation-delay: 0.7s">🛡️</span>
          <span class="nt-icon" style="animation-delay: 1.1s">🔍</span>
          <span class="nt-icon" style="animation-delay: 1.5s">✉️</span>
          <span class="nt-icon" style="animation-delay: 1.9s">🔮</span>
        </div>
        <div class="nt-dawn"></div>
      </div>
    </Transition>

    <!-- 每夜事件弹窗：提示昨夜实际发生的事情（死讯/平安夜，带动画） -->
    <Transition name="ovl">
    <div v-if="nightEvent && !state.gameOver" class="review-overlay night-event-overlay" @click.self="nightEvent = null">
      <div class="review-modal night-event-modal">
        <!-- 第一幕：夜空背景层（星星闪烁，随后褪去） -->
        <div class="night-sky" aria-hidden="true">
          <span v-for="s in 12" :key="s" class="star" :style="{ left: (s * 8 - 4) + '%', animationDelay: (s * 0.18) + 's' }"></span>
        </div>
        <div class="night-event-icon" :class="nightEvent.peaceful ? 'peaceful' : 'death'">{{ nightEvent.peaceful ? '🌙' : '💀' }}</div>
        <h3 class="night-event-title">第 {{ nightEvent.round }} 天 · 天亮了</h3>
        <p v-if="nightEvent.peaceful" class="night-event-text">昨夜风平浪静，是个平安夜。</p>
        <p v-else class="night-event-text">昨夜，黑暗夺走了<span v-for="(n, i) in nightEvent.deaths" :key="n" class="night-event-dead" :style="{ animationDelay: (1.5 + i * 0.3) + 's' }">「{{ n }}」</span>的生命——尸体在清晨被发现，身份未知。</p>
        <button class="btn primary" @click="nightEvent = null">知道了</button>
      </div>
    </div>
    </Transition>

    <!-- 终局结算弹窗（独立组件 EndModal）：胜负结算 + 谢幕演出 + 逐夜回顾入口 -->
    <EndModal
      :show="showEndModal"
      :game-over="state.gameOver"
      :winner="d.winner"
      :roles="d.roles"
      :ending-art="endingArt"
      :portraits="portraits"
      :portrait-loading="portraitLoading"
      :has-night-logs="nightLogs.length > 0"
      @close="showEndModal = false"
      @load-portrait="loadPortrait"
      @review="showNightReview = true"
      @restart="restart"
    />

    <!-- 终局：逐夜行动回顾浮层（每夜一张关系图 + 对齐后的说明文字） -->
    <Transition name="ovl">
    <div v-if="showNightReview && nightLogs.length" class="review-overlay" @click.self="showNightReview = false">
      <div class="review-modal">
        <div class="review-head">
          <h3>逐夜行动回顾</h3>
          <button class="review-close" @click="showNightReview = false">✕</button>
        </div>
        <div class="review-body">
          <div v-for="(l, i) in nightLogs" :key="i" class="night-graph-card">
            <div class="night-graph-title">第{{ l.round }}夜</div>
            <NightActionGraph :log="l" :roles="d.roles || []" />
            <div class="night-detail">{{ formatNightLog(l) }}</div>
          </div>
        </div>
      </div>
    </div>
    </Transition>
  </div>
</template>

<style scoped>
.game {
  display: flex;
  height: 100%;
  position: relative;
  /* 昼夜主题 1.5s 平滑渐变 */
  transition: background-color 1.5s ease;
}
/* 白天：暖色调（米金/晨光） */
.game.theme-day {
  --bg: var(--bg-day);
  --panel: var(--panel-day);
  --panel-2: var(--panel-2-day);
  --border: var(--border-day);
  background: var(--bg-day);
}
/* 夜晚：深蓝夜色 */
.game.theme-night {
  --bg: var(--bg-night);
  --panel: var(--panel-night);
  --panel-2: var(--panel-2-night);
  --border: var(--border-night);
  background: var(--bg-night);
}
.game.theme-day .side-panel,
.game.theme-night .side-panel {
  transition: background-color 1.5s ease, border-color 1.5s ease;
}
/* —— 处刑仪式感：全屏闪白 + 弹窗震动 + 翻牌聚光灯 —— */
.gavel-flash {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: #fff;
  pointer-events: none;
  animation: gf-flash 0.6s ease-out forwards;
}
@keyframes gf-flash {
  0% { opacity: 0.85; }
  100% { opacity: 0; }
}
.exec-modal {
  animation: exec-shake 0.5s ease 0.15s;
}
@keyframes exec-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}
/* 翻牌聚光灯：牌周围变暗、牌本身高亮 */
.exec-flip {
  position: relative;
}
.exec-flip::before {
  content: '';
  position: absolute;
  inset: -26px -18px;
  background: radial-gradient(circle, transparent 30%, rgba(6, 8, 16, 0.5) 70%);
  opacity: 0;
  /* 闪一下即淡出：翻牌瞬间聚光，翻完不残留（避免深色遮罩遮挡卡片） */
  animation: spotlight 1.1s ease 0.4s forwards;
  pointer-events: none;
  z-index: 1;
}
@keyframes spotlight {
  0% { opacity: 0; }
  35% { opacity: 1; }
  100% { opacity: 0; }
}
.exec-flip-inner {
  z-index: 2;
}
/* —— 夜晚结算过场：黑幕 → 剪影掠过 → 天光渐亮 —— */
.night-transition {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: #060810;
  animation: nt-curtain 2.5s ease forwards;
  pointer-events: none;
  overflow: hidden;
}
@keyframes nt-curtain {
  0% { opacity: 0; }
  12% { opacity: 1; }
  82% { opacity: 1; }
  100% { opacity: 0; }
}
.nt-silhouettes {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8vw;
}
.nt-icon {
  font-size: 42px;
  opacity: 0;
  filter: brightness(0.55);
  animation: nt-sweep 0.9s ease both;
}
@keyframes nt-sweep {
  0% { opacity: 0; transform: translateX(-70px) scale(0.8); }
  35% { opacity: 0.9; }
  100% { opacity: 0; transform: translateX(70px) scale(1.15); }
}
.nt-dawn {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(232, 193, 90, 0.28), transparent 65%);
  opacity: 0;
  animation: nt-dawn-glow 1s ease 1.6s forwards;
}
@keyframes nt-dawn-glow {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
/* 星星粒子背景层（夜晚） */
.night-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}
.np-star {
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: #cdd9f0;
  animation: np-twinkle 2.4s ease-in-out infinite;
}
@keyframes np-twinkle {
  0%, 100% { opacity: 0.1; transform: scale(0.7); }
  50% { opacity: 0.85; transform: scale(1.25); }
}

.side-panel {
  width: 280px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: calc(var(--bar-h, 48px) + 16px) 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-head h2 {
  font-size: 18px;
  color: var(--accent-2);
}

.phase-badge {
  text-align: center;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  background: rgba(212, 161, 44, 0.15);
  color: var(--accent-2);
}
.phase-badge.adjudicate { background: rgba(180, 60, 60, 0.2); color: #e88; }
.phase-badge.win { background: rgba(60, 160, 80, 0.2); color: #8d8; }
.phase-badge.lose { background: rgba(120, 120, 120, 0.2); color: var(--text-dim); }

.judge-hint {
  font-size: 13px;
}
.muted { color: var(--text-dim); font-size: 13px; }

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-dim);
}

.players h3,
.deaths h3,
.reveal h3,
.role-pool h3,
.claims h3 {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.role-pool {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.role-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.role-chip {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(212, 161, 44, 0.12);
  color: var(--accent-2);
  border: 1px solid rgba(212, 161, 44, 0.25);
}

.roledeck {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.deck-toggle {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--accent-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.deck-toggle:hover {
  border-color: var(--accent);
}
.deck-body {
  margin-top: 8px;
}
.deck-group {
  margin-bottom: 8px;
}
.deck-group-label {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 4px;
  font-weight: 600;
}
.deck-role {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 6px;
  background: var(--panel-2);
}
.deck-role.inalive {
  border-color: rgba(212, 161, 44, 0.45);
  background: rgba(212, 161, 44, 0.06);
}
.deck-role-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.deck-role-head b {
  font-size: 13px;
  color: var(--text);
}
.in-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(212, 161, 44, 0.2);
  color: var(--accent-2);
  font-weight: 600;
}
.deck-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
  margin-top: 3px;
}

.claims {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.claim-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
  font-size: 14px;
}
.claim-row.conflict {
  background: rgba(200, 60, 60, 0.1);
  border-radius: 4px;
  padding: 3px 6px;
}
.claim-name { color: var(--text); }
.claim-role { font-size: 13px; color: var(--accent-2); font-weight: 600; }
.conflict-hint {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.conflict-tag {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(200, 60, 60, 0.15);
  color: #e88;
}

.player-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 14px;
}
.player-row.dead { opacity: 0.45; text-decoration: line-through; }
.player-status { font-size: 12px; color: var(--text-dim); }
.player-name { cursor: pointer; }
.player-name:hover { color: var(--accent-2); }
.mark-toggle {
  margin-left: 6px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.mark-toggle:hover { color: var(--accent-2); border-color: var(--accent); }
.mark-toggle.active { color: var(--accent); border-color: var(--accent); }
.mark-toggle.marked { color: var(--accent); }
.player-mark {
  margin-left: 6px;
  font-size: 12px;
  color: var(--accent);
}
.player-mark.role-good { color: #8d8; }
.player-mark.role-neutral { color: #58a6ff; }
.player-mark.role-wolf { color: var(--danger); }
.player-mark.hit { color: #3fb950 !important; }
.player-mark.miss { color: #d9524e !important; }
.player-mark.hit { color: #3fb950; }
.player-mark.miss { color: #d9524e; }
.mark-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px dashed var(--border);
}
.mark-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.mark-row-label {
  font-size: 11px;
  color: var(--text-dim);
  min-width: 26px;
}
.mark-btn {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text);
}
.mark-btn.active {
  border-color: var(--accent);
  color: var(--accent-2);
}
.mark-btn.clear { color: var(--text-dim); }

.deaths {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.death-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 3px 0;
  font-size: 13px;
}
.death-round { color: var(--text-dim); font-size: 11px; }
.death-name { color: var(--text); }
.death-cause { color: var(--text-dim); font-size: 12px; }
.role-wolf { color: var(--danger); font-weight: 600; font-size: 12px; }
.role-neutral { color: #58a6ff; font-weight: 600; font-size: 12px; }
.role-good { color: #8d8; font-weight: 600; font-size: 12px; }
.reveal-turned { font-size: 11px; color: var(--text-dim); font-weight: 400; }

.reveal {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.reveal-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 14px;
}

.review-btn {
  margin-top: 10px;
}
/* 弹窗收回动画：遮罩淡出 + 弹窗缩小下沉（展开动画保持原有 evt-pop） */
.ovl-enter-active {
  transition: opacity 0.2s ease;
}
.ovl-enter-active .review-modal {
  animation: evt-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ovl-leave-active {
  transition: opacity 0.22s ease;
}
.ovl-leave-active .review-modal {
  transition: transform 0.22s ease, opacity 0.22s ease;
  transform: scale(0.85) translateY(14px);
  opacity: 0;
}
.ovl-enter-from,
.ovl-leave-to {
  opacity: 0;
}
/* 抽屉收回动画：遮罩淡出 + 面板滑落 */
.drw-enter-active {
  transition: opacity 0.2s ease;
}
.drw-enter-active.drawer-panel {
  animation: drawer-up 0.22s ease-out;
}
.drw-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.drw-leave-active.drawer-panel {
  transform: translateY(100%);
}
.drw-enter-from,
.drw-leave-to {
  opacity: 0;
}
.drw-leave-active.drawer-panel {
  opacity: 1;
}
.drw-leave-to.drawer-panel {
  transform: translateY(100%);
}
/* 静态天分隔标题（替代原折叠按钮） */
.day-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  padding: 8px 0 6px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 4px;
}
/* 处刑结果弹窗 */
.exec-modal {
  max-width: 380px;
  text-align: center;
  padding: 22px 20px 18px;
  animation: evt-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.exec-gavel {
  font-size: 44px;
  line-height: 1;
  margin-bottom: 10px;
  display: inline-block;
  animation: exec-slam 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.exec-gavel.pass {
  animation: shield-rise 0.8s ease-out both, evt-float 2.2s ease-in-out 0.8s infinite;
}
@keyframes exec-slam {
  0% { transform: translate(60px, -60px) rotate(120deg); opacity: 0; }
  55% { transform: translate(-4px, 4px) rotate(-14deg); opacity: 1; }
  75% { transform: translate(0, 0) rotate(6deg); }
  100% { transform: rotate(0); }
}
@keyframes shield-rise {
  0% { transform: translateY(24px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
/* 身份牌 3D 翻牌：卡片入场 → 牌背问号 → 翻转显示身份 */
.exec-card {
  animation: dead-reveal 0.5s ease both;
}
.exec-flip {
  perspective: 600px;
  display: inline-block;
  vertical-align: middle;
  margin: 4px 0;
}
.exec-flip-inner {
  position: relative;
  width: 92px;
  height: 40px;
  transform-style: preserve-3d;
  animation: card-flip 0.55s cubic-bezier(0.34, 1.2, 0.64, 1) 0.7s both;
}
.exec-flip-back,
.exec-flip-front {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  backface-visibility: hidden;
  border: 1px solid var(--border);
}
.exec-flip-back {
  background: repeating-linear-gradient(45deg, var(--panel-2), var(--panel-2) 6px, var(--border) 6px, var(--border) 12px);
  color: var(--text-dim);
  font-size: 18px;
  font-weight: 700;
}
.exec-flip-front {
  background: var(--panel);
  transform: rotateY(180deg);
}
@keyframes card-flip {
  0% { transform: rotateY(0); }
  100% { transform: rotateY(180deg); }
}
.exec-title {
  margin: 0 0 8px;
  font-size: 16px;
}
.exec-text {
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 10px;
}
.exec-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.8;
}
.exec-role {
  font-size: 15px;
}
.exec-verdict {
  display: block;
  color: var(--text-dim);
  font-size: 12px;
  margin-top: 2px;
}
/* 裁决入口（按需弹出） */
.adjudicate-entry {
  display: flex;
  justify-content: center;
  padding: 10px 12px;
  border-top: 1px dashed var(--border);
}
.adjudicate-modal {
  max-width: 460px;
  animation: evt-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.adjudicate-modal .adjudicate-hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
}
.adjudicate-modal .vote-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.adjudicate-modal .pass-btn {
  width: 100%;
  margin-top: 6px;
}
/* 手机端按天翻页指示条 */
.day-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 0 8px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 6px;
}
.pager-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  width: 34px;
  height: 30px;
  font-size: 16px;
  cursor: pointer;
}
.pager-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.pager-indicator {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
}
/* 每夜事件弹窗 */
/* 第一幕：夜空背景层——深蓝渐变 + 星星闪烁，随后整体褪去 */
.night-sky {
  position: absolute;
  inset: 0;
  border-radius: 12px 12px 0 0;
  background: linear-gradient(180deg, #0b1026 0%, #131a3a 55%, transparent 100%);
  animation: sky-fade 2.6s ease forwards;
  pointer-events: none;
  overflow: hidden;
}
.star {
  position: absolute;
  top: 12%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #e6edf3;
  animation: star-twinkle 1.6s ease-in-out infinite;
}
@keyframes star-twinkle {
  0%, 100% { opacity: 0.15; transform: scale(0.8); }
  50% { opacity: 0.9; transform: scale(1.2); }
}
@keyframes sky-fade {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}
.night-event-modal {
  position: relative;
  max-width: 360px;
  text-align: center;
  padding: 22px 20px 18px;
  animation: evt-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.night-event-icon {
  font-size: 44px;
  line-height: 1;
  margin-bottom: 10px;
}
.night-event-icon.death {
  animation: death-drop 0.7s cubic-bezier(0.34, 1.2, 0.64, 1) 0.2s both, evt-shake 0.6s ease 0.9s;
}
.night-event-icon.peaceful {
  animation: moon-rise 1.2s ease-out 0.2s both, evt-float 2.2s ease-in-out 1.4s infinite;
}
/* 死者名字逐个延迟淡入（模板内联 animationDelay 控制间隔） */
.night-event-dead {
  animation: dead-reveal 0.5s ease both;
}
@keyframes death-drop {
  0% { transform: translateY(-46px) scale(1.3); opacity: 0; }
  60% { transform: translateY(4px) scale(1); opacity: 1; }
  100% { transform: translateY(0); }
}
@keyframes moon-rise {
  0% { transform: translateY(22px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes dead-reveal {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
.night-event-title {
  margin: 0 0 8px;
  font-size: 16px;
}
.night-event-text {
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 14px;
}
.night-event-dead {
  color: #f85149;
  font-weight: 600;
}
@keyframes evt-pop {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes evt-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
@keyframes evt-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
/* 终局结算弹窗 */
.end-modal {
  max-width: 380px;
  text-align: center;
  padding: 26px 22px 22px;
  animation: evt-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.end-modal {
  position: relative;
  overflow-x: hidden;
  max-height: 88vh; /* 十人局卡片较多时允许纵向滚动，避免最后一行被裁切 */
  overflow-y: auto;
  /* 隐藏滚动条：卡片入场动画期间内容高度变化会让滚动条时隐时现，影响观感；滚动功能保留 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.end-modal::-webkit-scrollbar {
  display: none;
}
.end-art-btn {
  margin: 4px 0 8px;
  font-size: 13px;
}
.end-art-loading {
  color: var(--text-dim);
  font-size: 12px;
  margin: 8px 0;
}
/* 胜利光晕：金色光圈扩散 + 持续脉动 */
.end-modal-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 50% 30%, rgba(212, 161, 44, 0.22), transparent 60%);
  animation: glow-pulse 2.8s ease-in-out infinite;
}
@keyframes glow-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1.04); }
}
.end-modal-icon {
  font-size: 52px;
  line-height: 1;
  margin-bottom: 12px;
  position: relative;
}
.end-modal-icon.win {
  animation: sun-rise 1.1s ease-out both, evt-float 2.2s ease-in-out 1.1s infinite;
}
.end-modal-icon.lose {
  animation: wolf-emerge 1.2s ease-out both;
}
@keyframes sun-rise {
  0% { transform: translateY(30px) scale(0.7); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes wolf-emerge {
  0% { transform: scale(0.8); opacity: 0; filter: blur(6px) brightness(0.3); }
  100% { transform: scale(1); opacity: 1; filter: blur(0) brightness(1); }
}
/* 终局插画：渐显入场 */
.end-art {
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  border-radius: 10px;
  margin-bottom: 10px;
  position: relative;
  z-index: 2;
  animation: art-reveal 1.2s ease 0.6s both;
}
@keyframes art-reveal {
  0% { opacity: 0; transform: scale(0.94); }
  100% { opacity: 1; transform: scale(1); }
}
/* —— 终局谢幕演出 —— */
/* 胜利：角色卡片从两侧依次滑入排列成终局阵容 */
.end-curtain-call {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 12px 0 4px;
  position: relative;
  z-index: 2;
}
.curtain-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  font-size: 11px;
  opacity: 0;
  animation: curtain-slide 0.6s cubic-bezier(0.34, 1.3, 0.64, 1) both;
}
.end-curtain-call.win .curtain-card:nth-child(odd) {
  --slide-from: -60px;
}
.end-curtain-call.win .curtain-card:nth-child(even) {
  --slide-from: 60px;
}
@keyframes curtain-slide {
  0% { opacity: 0; transform: translateX(var(--slide-from, 0)) translateY(10px); }
  100% { opacity: 1; transform: translateX(0) translateY(0); }
}
.curtain-name {
  color: var(--text);
  font-weight: 600;
  margin-bottom: 2px;
}
.curtain-card {
  cursor: pointer;
}
.curtain-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
}
.curtain-portrait {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 4px;
  animation: art-reveal 0.8s ease both;
}
/* 失败：红色迷雾从屏幕边缘渗入笼罩界面 */
.end-modal.lose {
  overflow: hidden;
}
.end-modal.lose::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 0% 50%, rgba(248, 81, 73, 0.28), transparent 45%),
    radial-gradient(ellipse at 100% 50%, rgba(248, 81, 73, 0.28), transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(248, 81, 73, 0.2), transparent 50%);
  animation: fog-seep 2.2s ease 0.8s forwards;
  opacity: 0;
}
@keyframes fog-seep {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
/* 标题逐字浮现（模板内联 animationDelay 控制间隔） */
.end-title-char {
  display: inline-block;
  animation: char-reveal 0.4s ease both;
}
@keyframes char-reveal {
  0% { opacity: 0; transform: translateY(8px) scale(0.85); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.end-modal-title {
  margin: 0 0 16px;
  font-size: 17px;
}
.end-modal-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.end-modal-actions .review-btn {
  margin-top: 0;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
}
.end-modal-actions .review-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.review-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}
.review-modal {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-width: 720px;
  width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
}
.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.review-head h3 {
  margin: 0;
  font-size: 15px;
}
.review-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}
.review-body {
  overflow-y: auto;
  padding: 10px 14px;
}
.night-graph-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  margin: 8px 0;
  background: var(--panel-2);
}
.night-graph-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.night-graph-card .night-detail {
  display: block;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
  margin-top: 4px;
}
.night-log-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.5;
}
.night-round {
  flex-shrink: 0;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
}
.night-detail {
  color: var(--text);
}

.main-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: calc(var(--bar-h, 48px) + 20px) 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.msg {
  max-width: 100%;
  align-self: stretch;
}
.msg-content {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--panel-2);
  border: 1px solid var(--border);
}
/* —— 发言卡片化：专属色竖条 + 首字徽章 —— */
.msg-card {
  position: relative;
  margin-bottom: 8px;
}
.msg-card .msg-content {
  border-left: 3px solid var(--pc, var(--border));
  position: relative;
  transition: opacity 0.4s ease, border-color 0.4s ease, transform 0.4s ease;
}
.msg-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #0e1428;
  font-size: 13px;
  font-weight: 700;
  margin-right: 6px;
  vertical-align: middle;
  flex-shrink: 0;
}
/* 死者卡片：变灰 + 💀 角标 + 轻微倾斜（视觉上退出对话） */
.msg-card.msg-dead .msg-content {
  opacity: 0.55;
  transform: rotate(-0.6deg);
  filter: grayscale(0.6);
}
.msg-card.msg-dead .msg-content::after {
  content: '💀';
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 14px;
  opacity: 0.8;
}
/* 被处刑者卡片：红色边框渐隐动画 */
.msg-card.msg-executed .msg-content {
  border-color: rgba(248, 81, 73, 0.55);
  animation: executed-fade 2.4s ease;
}
@keyframes executed-fade {
  0% { border-color: #f85149; box-shadow: 0 0 12px rgba(248, 81, 73, 0.35); }
  100% { border-color: rgba(248, 81, 73, 0.55); box-shadow: none; }
}
/* —— 终局阵营着色：全场发言按真实阵营重新着色 —— */
.msg-card.msg-camp-good .msg-content {
  border-left-color: #58a6ff;
  background: linear-gradient(90deg, rgba(88, 166, 255, 0.08), transparent 40%), var(--panel-2);
}
.msg-card.msg-camp-neutral .msg-content {
  border-left-color: #d29922;
  background: linear-gradient(90deg, rgba(210, 153, 34, 0.08), transparent 40%), var(--panel-2);
}
.msg-card.msg-camp-evil .msg-content {
  border-left-color: #f85149;
  background: linear-gradient(90deg, rgba(248, 81, 73, 0.1), transparent 40%), var(--panel-2);
}
.msg-card.msg-camp-evil .speaker {
  color: #f85149 !important;
}

/* —— 回到底部悬浮按钮 —— */
.back-bottom {
  position: fixed;
  right: 18px;
  bottom: 84px;
  z-index: 35;
  padding: 10px 16px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--accent-2);
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  min-height: 40px;
}
.back-bottom:hover {
  border-color: var(--accent);
}

/* —— 阅读重点强化：发言者着色 / 关键词标记 / 天分组 —— */
.speaker {
  font-weight: 700;
}
.mk-claim {
  font-weight: 700;
  color: var(--accent-2);
}
.mk-clue {
  color: #58a6ff;
}
.mk-doubt {
  color: #f0883e;
}
.day-group {
  margin-bottom: 6px;
}
.day-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 6px;
  min-height: 40px;
}
.day-toggle:hover {
  border-color: var(--accent);
}
.day-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-dim);
}
.conflict-flag {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid #f0883e;
  color: #f0883e;
  font-size: 12px;
  font-weight: 600;
  cursor: help;
  vertical-align: 1px;
}
.loading-text {
  color: var(--text-dim);
  font-style: italic;
}

.error-bar {
  padding: 8px 16px;
  color: var(--danger);
  font-size: 13px;
  background: rgba(200, 60, 60, 0.08);
}

.listen-bar {
  padding: 14px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.listen-btn {
  width: 100%;
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  border: 1px solid var(--accent);
  background: rgba(212, 161, 44, 0.12);
  color: var(--accent-2);
  cursor: pointer;
  transition: all 0.15s;
}
.listen-btn:hover:not(:disabled) {
  background: rgba(212, 161, 44, 0.22);
}
.listen-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.listen-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
}

.adjudicate-panel {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.adjudicate-hint {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.vote-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.execute-btn.picked {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(217, 82, 78, 0.12);
}
.execute-btn {
  padding: 8px 14px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: rgba(200, 60, 60, 0.08);
  color: #e88;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.execute-btn:hover:not(:disabled) {
  background: rgba(200, 60, 60, 0.2);
}
.execute-btn:disabled,
.pass-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pass-btn {
  width: 100%;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.pass-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
}

.end-bar {
  padding: 16px;
  text-align: center;
  border-top: 1px solid var(--border);
}
.end-text {
  font-size: 18px;
  font-weight: 600;
}

/* 移动端快捷导航：吸顶摘要 + 底部工具栏 + 抽屉（桌面端隐藏） */
.mobile-summary,
.mobile-dock,
.drawer-mask,
.drawer-panel {
  display: none;
}

/* 移动端适配：侧栏改顶部通栏，触控目标 ≥44px */
@media (max-width: 768px) {
  .mobile-summary {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
    position: sticky;
    top: 0;
    z-index: 30;
    padding: calc(8px + env(safe-area-inset-top)) 12px 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-dim);
  }
  .ms-phase {
    color: var(--accent-2);
  }
  .mobile-dock {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 40;
    background: var(--panel);
    border-top: 1px solid var(--border);
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
  }
  .mobile-dock button {
    flex: 1;
    min-height: 44px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel-2);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    margin: 0 4px;
  }
  .mobile-dock button:active,
  .mobile-dock button.on {
    border-color: var(--accent);
    color: var(--accent-2);
  }
  /* 底部抽屉：覆盖式面板，页面不滚动，关闭后阅读位置不变 */
  .drawer-mask {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 45;
    background: rgba(0, 0, 0, 0.5);
  }
  .drawer-panel {
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    max-height: 62vh;
    background: var(--panel);
    border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.4);
    animation: drawer-up 0.22s ease-out;
  }
  @keyframes drawer-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  .drawer-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .drawer-head h3 {
    margin: 0;
    font-size: 15px;
    color: var(--text);
  }
  .drawer-close {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--text-dim);
    font-size: 13px;
    cursor: pointer;
    min-height: 32px;
  }
  .drawer-body {
    overflow-y: auto;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    -webkit-overflow-scrolling: touch;
  }
  .drawer-empty {
    color: var(--text-dim);
    font-size: 13px;
    text-align: center;
    margin: 20px 0;
  }
  /* 移动端主界面精简：与抽屉重复的区块（角色说明/自称身份/在场者）不再显示，发言流成为主体 */
  .roledeck,
  .claims,
  .players {
    display: none;
  }
  /* 底部工具栏不遮挡主区内容 */
  .main-panel {
    padding-bottom: 72px;
  }
  .game {
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  /* 单屏布局：侧栏整体隐藏（信息走抽屉），主区占满全屏，仅发言流内部滚动，页面不翻页 */
  .side-panel {
    display: none;
  }
  .main-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .side-panel {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .btn {
    min-height: 44px;
  }
}
/* —— 阶段三动效：消息入场 + 按钮微交互 + 阶段标题文字动画（对标 reactbits/animata） —— */
.msg { animation: msg-in 0.32s ease both; }
@keyframes msg-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.phase-badge { animation: badge-in 0.55s ease both; }
@keyframes badge-in { from { opacity: 0; letter-spacing: 0.45em; } to { opacity: 1; letter-spacing: normal; } }
/* —— 阶段三第4项：消息卡片悬停反馈——边框亮起+轻微提亮，操作反馈而非装饰 —— */
.msg .msg-content { transition: border-color 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease; }
.msg:hover .msg-content { border-color: var(--accent); filter: brightness(1.06); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18); }
</style>
