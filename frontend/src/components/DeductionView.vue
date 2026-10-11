<script setup>
import { ref, computed, onMounted, nextTick, watch, inject } from 'vue';

const { state, listenSpeeches, adjudicateTarget, backToHome, restart } = inject('game');

const messagesEl = ref(null);
const showRoles = ref(false);

// —— 玩家标记（推测身份笔记）：仅存本地浏览器、按游戏隔离，不上传服务器、不影响游戏逻辑 ——
const BASE_ROLES = ['文员', '侦探', '村民', '法医', '守卫', '赌徒', '小偷', '狼人', '帮凶', '酒鬼'];
const ADV_ROLES = [...BASE_ROLES, '观者', '邮差', '行者', '庸医', '间谍', '小丑', '术士'];
const marks = ref({});
const markOpenId = ref('');
const MARK_KEY = computed(() => `rpg_marks_${state.gameId || ''}`);
const NEUTRAL_ROLES = ['赌徒', '小偷', '庸医', '间谍'];
const EVIL_ROLES = ['狼人', '帮凶', '酒鬼', '小丑', '术士'];
const ALL_ROLES = computed(() => (d.value.board === 'advanced' ? ADV_ROLES : BASE_ROLES));
function roleClass(role) {
  if (EVIL_ROLES.includes(role)) return 'role-wolf';
  if (NEUTRAL_ROLES.includes(role)) return 'role-neutral';
  return 'role-good';
}
function loadMarks() {
  try {
    marks.value = JSON.parse(localStorage.getItem(MARK_KEY.value) || '{}');
  } catch {
    marks.value = {};
  }
}
function saveMarks() {
  try {
    localStorage.setItem(MARK_KEY.value, JSON.stringify(marks.value));
  } catch {
    /* ignore */
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
// 终局对比：标记与真实身份（含变身前原身份）任一匹配即命中
function markHit(p) {
  const roles = d.value.roles;
  if (!roles || !marks.value[p.id]) return false;
  const real = roles.find((r) => r.name === p.name);
  return !!real && (real.role === marks.value[p.id] || (real.roleBackup && real.roleBackup === marks.value[p.id]));
}
watch(() => state.gameId, loadMarks, { immediate: true });

const d = computed(() => state.deduction || {});
const phase = computed(() => d.value.phase || 'day');
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
function formatNightLog(l) {
  const parts = [];
  if (l.wolf) parts.push(l.wolf.blocked ? `狼人袭击「${l.wolf.target}」→ 被守卫挡下` : `狼人刀杀「${l.wolf.killed || l.wolf.target}」`);
  if (l.guard) parts.push(`守卫保护「${l.guard.target}」`);
  if (l.detective) parts.push(`侦探探访「${l.detective.target}」（${l.detective.clue}）`);
  if (l.accomplice) parts.push(`帮凶拜访「${l.accomplice.target}」`);
  if (l.thief) parts.push(`小偷造访「${l.thief.target}」${l.thief.effect ? '，' + l.thief.effect : ''}`);
  if (l.gambler) parts.push(`赌徒猜「${l.gambler.target}」为${l.gambler.claim}（${l.gambler.correct ? '正确' : '错误'}${l.gambler.died ? '，赌徒殒命' : ''}）`);
  if (l.forensics && l.forensics.role) parts.push(`法医鉴定「${l.forensics.target}」→ ${l.forensics.role}`);
  if (l.drunkAffected && l.drunkAffected.length) parts.push(`酒鬼迷醉：${l.drunkAffected.join('、')}`);
  if (l.watcher) parts.push(`观者观测「${l.watcher.target}」→ ${l.watcher.camp}阵营`);
  if (l.postman) parts.push(l.postman.saved ? `邮差送信给「${l.postman.target}」时察觉杀机——狼人空刀` : `邮差给「${l.postman.target}」送信，无事发生`);
  if (l.walker) parts.push(l.walker.kill ? `行者拜访「${l.walker.target}」——对方是坏人，同归于尽` : `行者拜访「${l.walker.target}」，探明其身份`);
  if (l.spy) parts.push(`间谍拜访「${l.spy.target}」，明日将${l.spy.lie ? '撒谎' : '如实发言'}`);
  if (l.clown) parts.push(`小丑扭曲了「${l.clown.target}」的记忆`);
  if (l.warlock) parts.push(`术士链接了「${l.warlock.links[0]}」与「${l.warlock.links[1]}」的命运${l.warlock.chain && l.warlock.chain.length ? `，连锁带走了${l.warlock.chain.join('、')}` : ''}`);
  if (l.quack) {
    if (l.quack.saves && l.quack.saves.length) parts.push(`庸医救下了${l.quack.saves.join('、')}`);
    if (l.quack.poisons && l.quack.poisons.length) parts.push(`庸医的药毒杀了${l.quack.poisons.join('、')}`);
  }
  if (l.deaths && l.deaths.length) parts.push(`本夜逝去：${l.deaths.join('、')}`);
  return parts.join('；');
}

const isAdvanced = computed(() => d.value.board === 'advanced');
const execPicks = ref([]); // 十人局：勾选的处决目标（最多 2 人）
function togglePick(id) {
  const i = execPicks.value.indexOf(id);
  if (i >= 0) execPicks.value.splice(i, 1);
  else if (execPicks.value.length < 2) execPicks.value.push(id);
}
function doExecute(targetId) {
  if (isAdvanced.value) {
    if (!execPicks.value.length) return;
    const names = execPicks.value
      .map((id) => (d.value.players || []).find((x) => x.id === id)?.name)
      .filter(Boolean)
      .join('」与「');
    const sure = window.confirm(`确定处刑「${names}」吗？处刑会公开其真实身份牌，若误伤好人将损失好人。`);
    if (!sure) return;
    adjudicateTarget(execPicks.value.slice());
    execPicks.value = [];
    return;
  }
  const p = (d.value.players || []).find((x) => x.id === targetId);
  const sure = window.confirm(`确定处刑「${p?.name || ''}」吗？处刑会公开其真实身份牌，若误伤好人将损失一名好人。`);
  if (!sure) return;
  adjudicateTarget(targetId);
}

function doPass() {
  const sure = window.confirm('确定放弃处刑吗？今天无人被放逐，直接进入下一夜。');
  if (!sure) return;
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
  <div class="game">
    <!-- 左侧：法官状态 + 存活玩家 + 死讯 -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>⚖️ {{ state.player?.name }}</h2>
        <button class="btn ghost" @click="backToHome">← 主菜单</button>
      </div>

      <div class="phase-badge" :class="phase">{{ PHASE_TEXT[phase] || phase }}</div>

      <div class="judge-hint">
        <span class="muted">你是法官——不参与游戏，只听发言、裁决处刑。</span>
      </div>

      <div class="stat-row">
        <span>第 {{ d.round || 1 }} 天</span>
        <span>存活 {{ d.aliveCount || 0 }}/{{ (d.players || []).length }}</span>
      </div>

      <!-- 角色卡（可展开） -->
      <div class="roledeck">
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
      <div v-if="(d.claims || []).length" class="claims">
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
      <div class="players">
        <h3>在场者</h3>
        <div
          v-for="p in d.players || []"
          :key="p.id"
          class="player-row"
          :class="{ dead: !p.alive }"
        >
          <span class="player-name" title="点击标记你推测的身份" @click="markOpenId = markOpenId === p.id ? '' : p.id">
            {{ p.name }}<span v-if="marks[p.id]" class="player-mark" :class="d.roles ? (markHit(p) ? 'hit' : 'miss') : ''">{{ marks[p.id] }}{{ d.roles ? (markHit(p) ? ' ✓' : ' ✗') : '' }}</span>
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
          <button
            v-for="r in ALL_ROLES"
            :key="r"
            class="mark-btn"
            :class="{ active: marks[markOpenId] === r }"
            @click="toggleMark(markOpenId, r)"
          >{{ r }}</button>
          <button class="mark-btn clear" @click="clearMark(markOpenId); markOpenId = ''">清除</button>
        </div>
      </div>

      <!-- 死讯 -->
      <div v-if="(d.deaths || []).length" class="deaths">
        <h3>死讯记录</h3>
        <div v-for="(dd, i) in d.deaths" :key="i" class="death-row">
          <span class="death-round">第{{ dd.round }}天</span>
          <span class="death-name">{{ dd.name }}</span>
          <span class="death-cause">{{ dd.cause === 'execute' ? '被处刑' : '夜里遇害' }}</span>
          <b v-if="dd.role" :class="roleClass(dd.role)">{{ dd.role }}</b>
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
      <div v-if="nightLogs.length" class="night-review">
        <h3>逐夜行动回顾</h3>
        <div v-for="(l, i) in nightLogs" :key="i" class="night-log-row">
          <span class="night-round">第{{ l.round }}夜</span>
          <span class="night-detail">{{ formatNightLog(l) }}</span>
        </div>
      </div>

      <button v-if="state.gameOver" class="btn primary full" @click="restart">再开一局</button>
    </aside>

    <!-- 主区：发言流 + 裁决面板 -->
    <main class="main-panel">
      <div class="messages" ref="messagesEl">
        <div
          v-for="(msg, i) in state.history"
          :key="i"
          class="msg assistant"
        >
          <div class="msg-content">{{ msg.content }}</div>
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
        <p class="listen-hint">法官无需发言，点击按钮即可听取在场所有人的陈述。</p>
      </div>

      <!-- 裁决面板 -->
      <div v-else-if="canAdjudicate" class="adjudicate-panel">
        <p class="adjudicate-hint">现在由你裁决。处刑某位存活者会公开其真实身份牌；或放弃处刑直接进入下一夜。</p>
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

      <div v-else-if="state.gameOver" class="end-bar">
        <p class="end-text">{{ d.winner === 'good' ? '🌅 狼人全部落网，好人获胜！' : '🐺 狼人潜伏到最后，好人失败…' }}</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.game {
  display: flex;
  height: 100%;
}

.side-panel {
  width: 280px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 16px;
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
.player-mark.hit { color: #3fb950; }
.player-mark.miss { color: #d9524e; }
.mark-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px dashed var(--border);
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

.night-review {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
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
  padding: 20px;
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
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--panel-2);
  border: 1px solid var(--border);
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

.btn {
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.15s;
}
.btn.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a1303;
}
.btn.ghost {
  border: 1px solid var(--border);
  color: var(--text-dim);
  background: transparent;
}
.btn.full {
  width: 100%;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
/* 移动端适配：侧栏改顶部通栏，触控目标 ≥44px */
@media (max-width: 768px) {
  .game {
    flex-direction: column;
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
</style>
