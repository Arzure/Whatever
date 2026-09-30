<script setup>
import { ref, computed, onMounted, nextTick, watch, inject } from 'vue';

const {
  state,
  hpPercent,
  submitAction,
  backToHome,
  restart,
  equipItem,
  unequipItem,
  loadCase,
  accuseSuspect,
  submitConfront,
} = inject('game');

const input = ref('');
const messagesEl = ref(null);

// 案件说明（含谜底）：默认折叠，展开前需二次确认
const caseOpen = ref(false);
const caseConfirmed = ref(false);
const caseDetail = ref(null);
const caseLoading = ref(false);

// 指认凶手面板
const accuseOpen = ref(false);
const accuseTarget = ref('');

// 举证面板（对质阶段）
const selectedClues = ref([]);

const d = computed(() => state.detective || {});
const phase = computed(() => d.value.phase || 'investigate');
const currentScene = computed(() => state.scenes.find((s) => s.id === d.value.currentScene) || null);
const clues = computed(() => d.value.clues || []);
const evidenceIds = computed(() => d.value.evidenceIds || []);
const equipped = computed(() => state.player?.slots?.evidence || null);
const disabled = computed(() => state.loading || state.gameOver);

const PHASE_TEXT = {
  investigate: '调查阶段',
  confront: '对质阶段',
  win: '案件告破',
  lose: '调查终止',
};

// 物证：从背包里取「物证·」前缀的物品
const evidenceItems = computed(() => (state.player?.inventory || []).filter((i) => i.startsWith('物证·')));
const clueItems = computed(() => (state.player?.inventory || []).filter((i) => i.startsWith('线索·')));

// 物证明细（描述）：按名称与背包「物证·」条目匹配
function evidenceDesc(item) {
  const name = item.startsWith('物证·') ? item.slice('物证·'.length) : item;
  const ev = (state.evidence || []).find((e) => e.name === name);
  return ev && ev.desc ? ev.desc : '';
}

function suspectName(id) {
  return state.suspects.find((s) => s.id === id)?.name || id;
}

function sceneName(id) {
  return state.scenes.find((s) => s.id === id)?.name || id;
}

function statusInfo(status) {
  if (status === 'confirmed') return { text: '已证实', cls: 'ok' };
  if (status === 'false') return { text: '谎话', cls: 'bad' };
  return null;
}

async function loadCaseDetail() {
  caseLoading.value = true;
  caseDetail.value = await loadCase();
  caseLoading.value = false;
}

async function toggleCase() {
  if (caseOpen.value) {
    caseOpen.value = false;
    return;
  }
  // 未确认时只展开到「二次确认」提示，不调取真相
  if (!caseConfirmed.value) {
    caseOpen.value = true;
    return;
  }
  if (!caseDetail.value) await loadCaseDetail();
  caseOpen.value = true;
}

// 二次确认后：立即调取并展示完整真相
async function confirmCase() {
  caseConfirmed.value = true;
  await loadCaseDetail();
  caseOpen.value = true;
}

// ---------- 动作 ----------
function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  submitAction(text);
}

function goScene(scene) {
  if (disabled.value || scene.id === d.value.currentScene) return;
  submitAction(`前往「${scene.name}」`, scene.id);
}

function askSuspect(name) {
  if (disabled.value) return;
  submitAction(`盘问${name}，向他了解案发前后他知道的情况`);
}

function confrontWith(suspectId) {
  accuseTarget.value = suspectId;
}

async function confirmAccuse() {
  if (!accuseTarget.value) return;
  const name = suspectName(accuseTarget.value);
  const sure = window.confirm(`确定指认「${name}」为凶手吗？指认错误会消耗你的精力（生命 -25）。`);
  if (!sure) return;
  const target = accuseTarget.value;
  accuseOpen.value = false;
  accuseTarget.value = '';
  await accuseSuspect(target);
}

function toggleClue(id) {
  const i = selectedClues.value.indexOf(id);
  if (i === -1) selectedClues.value.push(id);
  else selectedClues.value.splice(i, 1);
}

async function doConfront() {
  if (!selectedClues.value.length) {
    state.error = '请至少勾选一条线索再举证';
    return;
  }
  const ids = [...selectedClues.value];
  selectedClues.value = [];
  await submitConfront(ids);
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

onMounted(scrollToBottom);
watch(() => state.history.length, scrollToBottom);
watch(phase, (p) => {
  // 阶段推进时收起不再适用的面板
  if (p !== 'investigate') accuseOpen.value = false;
});
</script>

<template>
  <div class="game">
    <!-- 左侧：侦探状态 + 案件资料 -->
    <aside class="side-panel">
      <div class="panel-head">
        <h2>{{ state.player?.name }}</h2>
        <button class="btn ghost" @click="backToHome">← 主菜单</button>
      </div>

      <div class="phase-badge" :class="phase">{{ PHASE_TEXT[phase] || phase }}</div>

      <div class="stat">
        <div class="stat-label">生命 <b>{{ state.player?.hp }} / {{ state.player?.maxHp }}</b></div>
        <div class="bar"><div class="bar-fill hp" :style="{ width: hpPercent + '%' }"></div></div>
      </div>
      <div class="muted-line">指认失败 {{ d.failedAccusations || 0 }} 次 · 每失败一次损失 25 点生命</div>

      <!-- 案件说明（默认保密，含谜底） -->
      <div class="case-box">
        <button type="button" class="case-head" @click="toggleCase">
          <span>📁 案件说明<em>（含谜底，默认保密）</em></span>
          <span class="case-toggle">{{ caseOpen ? '收起' : '展开' }}</span>
        </button>
        <template v-if="caseOpen">
          <div v-if="!caseConfirmed" class="spoiler">
            <p>此处将揭示案件的全部真相：凶手、动机与手法。展开后剧透无法收回，确定要看吗？</p>
            <button class="btn ghost full" @click="confirmCase">我已了解，允许展开</button>
          </div>
          <div v-else-if="caseLoading" class="spoiler">正在调取案卷…</div>
          <div v-else-if="caseDetail" class="case-detail">
          <h4>{{ caseDetail.title }}</h4>
          <p class="case-sec"><b>世界设定：</b>{{ caseDetail.world }}</p>
          <p class="case-sec"><b>死者：</b>{{ caseDetail.victim?.name }}（{{ caseDetail.victim?.identity }}）<br />
            <b>死因：</b>{{ caseDetail.victim?.causeOfDeath }}<br />
            <b>发现：</b>{{ sceneName(caseDetail.victim?.foundAt) }} {{ caseDetail.victim?.foundTime }}
          </p>
          <p class="case-sec"><b>凶手：</b><span class="culprit">{{ suspectName(caseDetail.culpritId) }}</span></p>
          <p class="case-sec"><b>动机：</b>{{ caseDetail.crime?.motive }}<br />
            <b>手法：</b>{{ caseDetail.crime?.method }}<br />
            <b>时间窗：</b>{{ caseDetail.crime?.timeWindow }}<br />
            <b>破绽：</b>{{ caseDetail.crime?.trick }}
          </p>
          <p class="case-sec"><b>嫌疑人：</b></p>
          <ul class="case-list">
            <li v-for="s in caseDetail.suspects" :key="s.id">
              {{ s.name }}（{{ s.identity }}）—— {{ s.relation }}
            </li>
          </ul>
          <p class="case-sec"><b>物证：</b></p>
          <ul class="case-list">
            <li v-for="e in caseDetail.evidence" :key="e.id">
              {{ e.name }} @ {{ sceneName(e.foundAt) }} —— {{ e.desc }}
            </li>
          </ul>
          <p class="case-sec"><b>场景：</b></p>
          <ul class="case-list">
            <li v-for="sc in caseDetail.scenes" :key="sc.id">{{ sc.name }}：{{ sc.desc }}</li>
          </ul>
          <button class="btn ghost full" @click="caseOpen = false">收起案卷</button>
          </div>
        </template>
      </div>

      <!-- 场景 -->
      <div class="block">
        <h3>场景</h3>
        <div class="scene-list">
          <button
            v-for="sc in state.scenes"
            :key="sc.id"
            class="scene-btn"
            :class="{ active: sc.id === d.currentScene, visited: sc.visited }"
            :disabled="disabled"
            @click="goScene(sc)"
          >
            {{ sc.name }}<em v-if="!sc.visited">·未去</em>
          </button>
        </div>
      </div>

      <!-- 在场人物 -->
      <div class="block">
        <h3>在场人物</h3>
        <div class="person-list">
          <button
            v-for="p in state.present"
            :key="p.id"
            class="person-btn"
            :disabled="disabled"
            @click="askSuspect(p.name)"
          >
            {{ p.name }}<em>{{ p.identity }}</em>
          </button>
          <p v-if="!state.present.length" class="dim">这里没有其他人</p>
        </div>
      </div>

      <!-- 物证槽 -->
      <div class="slot">
        <span class="slot-label">物证</span>
        <span class="slot-value">{{ equipped ? equipped.replace('物证·', '') : '无' }}</span>
        <button v-if="equipped" class="slot-btn" :disabled="disabled" @click="unequipItem('evidence')">卸下</button>
      </div>

      <!-- 物证 -->
      <div class="block">
        <h3>物证（可装备）</h3>
        <ul class="inv">
          <li v-for="item in evidenceItems" :key="item" class="inv-item">
            <span :class="{ 'is-equipped': equipped === item }">{{ item.replace('物证·', '') }}</span>
            <span v-if="evidenceDesc(item)" class="clue-text evidence-desc">{{ evidenceDesc(item) }}</span>
            <button
              v-if="equipped !== item"
              class="slot-btn mini"
              :disabled="disabled"
              @click="equipItem(item)"
            >装备</button>
            <span v-else class="tag ok">已装备</span>
          </li>
          <li v-if="!evidenceItems.length" class="dim">尚未找到物证</li>
        </ul>
        <p class="tip">装备物证后，当面质问说谎者即可拆穿他的谎言</p>
      </div>

      <!-- 线索 -->
      <div class="block">
        <h3>线索（{{ clues.length }}）</h3>
        <ul class="inv clue-list">
          <li v-for="c in clues" :key="c.id" class="clue-item">
            <div class="clue-text">{{ c.text }}</div>
            <div class="clue-meta">
              <span class="dim">— {{ c.suspectName }}</span>
              <span v-if="statusInfo(c.status)" class="tag" :class="statusInfo(c.status).cls">
                {{ statusInfo(c.status).text }}
              </span>
            </div>
          </li>
          <li v-if="!clues.length" class="dim">还没有掌握任何线索</li>
        </ul>
      </div>
    </aside>

    <!-- 右侧：剧情流 + 行动区 -->
    <main class="main-panel">
      <div ref="messagesEl" class="messages">
        <div
          v-for="(m, i) in state.history"
          :key="i"
          class="msg"
          :class="m.role === 'user' ? 'user' : 'assistant'"
        >
          <div v-if="m.role === 'user'" class="bubble user-bubble">{{ m.content }}</div>
          <template v-else>
            <div class="narrative">{{ m.content }}</div>
            <div v-if="m.choices && m.choices.length" class="choices">
              <button
                v-for="c in m.choices"
                :key="c"
                class="choice"
                :disabled="state.loading"
                @click="submitAction(c)"
              >{{ c }}</button>
            </div>
          </template>
        </div>

        <div v-if="state.lastEffects.length" class="effects">
          <span v-for="(e, i) in state.lastEffects" :key="i">{{ e }}</span>
        </div>

        <div v-if="state.loading" class="typing">…… 正在梳理线索与证词 ……</div>

        <div v-if="phase === 'win'" class="ending win">
          🎉 案件告破！你已让真凶低头认罪，真相大白于天下。
          <div v-if="state.caseResult" class="case-result">
            <p class="case-result-title">📋 证据复盘（关键证据 {{ state.caseResult.got.length }}/{{ state.caseResult.total }}）</p>
            <template v-if="state.caseResult.got.length">
              <p class="case-result-sec"><b>你出示的关键证据：</b></p>
              <ul class="case-list">
                <li v-for="(c, i) in state.caseResult.got" :key="i">「{{ c.text }}」<em class="dim">（{{ c.holder }}）</em></li>
              </ul>
            </template>
            <template v-if="state.caseResult.missing.length">
              <p class="case-result-sec"><b>还有未掌握的关键证据：</b></p>
              <ul class="case-list">
                <li v-for="(c, i) in state.caseResult.missing" :key="i">「{{ c.text }}」<em class="dim">（{{ c.holder }}）</em></li>
              </ul>
            </template>
          </div>
        </div>
        <div v-else-if="phase === 'lose'" class="ending lose">
          💀 调查到此为止。接连的失误耗尽了你的精力，真凶仍逍遥法外。
        </div>
      </div>

      <div class="input-bar">
        <p v-if="state.error" class="error inline">{{ state.error }}</p>

        <!-- 指认凶手 -->
        <div v-if="phase === 'investigate'" class="action-row">
          <button class="btn danger" :disabled="disabled" @click="accuseOpen = !accuseOpen">
            ⚖️ {{ accuseOpen ? '收起' : '指认凶手' }}
          </button>
          <span class="tip">随时可以指认，但指认错误会消耗生命（-25）</span>
        </div>
        <div v-if="phase === 'investigate' && accuseOpen" class="accuse-panel">
          <div class="suspect-list">
            <button
              v-for="s in state.suspects"
              :key="s.id"
              class="suspect-btn"
              :class="{ active: accuseTarget === s.id }"
              @click="confrontWith(s.id)"
            >
              {{ s.name }}<em>{{ s.identity }}</em>
            </button>
          </div>
          <button class="btn primary full" :disabled="!accuseTarget || disabled" @click="confirmAccuse">
            确认指认{{ accuseTarget ? `「${suspectName(accuseTarget)}」` : '' }}
          </button>
        </div>

        <!-- 举证令其认罪 -->
        <div v-if="phase === 'confront'" class="confront-panel">
          <p class="confront-title">
            对质中：勾选你掌握的关键线索，一次性摆到<b>{{ suspectName(d.accusedSuspectId) }}</b>面前，逼他认罪。
            <em>举证失败不扣生命，线索也不会丢失。</em>
          </p>
          <ul class="clue-pick">
            <li v-for="c in clues" :key="c.id" class="clue-opt" :class="{ picked: selectedClues.includes(c.id) }">
              <label>
                <input type="checkbox" :checked="selectedClues.includes(c.id)" @change="toggleClue(c.id)" />
                {{ c.text }}
                <span class="dim">— {{ c.suspectName }}</span>
              </label>
            </li>
            <li v-if="!clues.length" class="dim">你还没有任何线索可供举证</li>
          </ul>
          <button class="btn primary full" :disabled="disabled || !selectedClues.length" @click="doConfront">
            举证（已选 {{ selectedClues.length }} 条）
          </button>
        </div>

        <form class="input-row" @submit.prevent="send">
          <input
            v-model="input"
            type="text"
            maxlength="200"
            placeholder="输入你的行动…（例：搜查吧台，寻找可疑痕迹）"
            :disabled="disabled"
            autocomplete="off"
          />
          <button class="btn primary" type="submit" :disabled="disabled">
            {{ state.loading ? '…' : '行动' }}
          </button>
        </form>

        <div v-if="state.gameOver" class="restart-row">
          <button class="btn primary" @click="restart">返回主菜单</button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.game {
  height: 100%;
  display: grid;
  grid-template-columns: 300px 1fr;
  max-width: 1200px;
  margin: 0 auto;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

.side-panel {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 20px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  align-self: flex-start;
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  background: var(--panel-2);
}

.phase-badge.confront {
  color: #fcc419;
  border-color: #fcc41955;
}

.phase-badge.win {
  color: #2ea043;
  border-color: #2ea04355;
}

.phase-badge.lose {
  color: var(--danger);
  border-color: #e5484d55;
}

.stat {
  font-size: 14px;
  color: var(--text-dim);
}

.stat b {
  color: var(--text);
  float: right;
}

.bar {
  height: 8px;
  background: var(--hp-bg);
  border-radius: 4px;
  margin-top: 6px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.bar-fill.hp {
  background: linear-gradient(90deg, #2ea043, var(--hp));
}

.muted-line {
  font-size: 12px;
  color: var(--text-dim);
}

.case-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--panel-2);
  font-size: 13px;
}

.case-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--accent-2);
}

.case-head em {
  font-style: normal;
  color: var(--text-dim);
  font-size: 12px;
}

.case-toggle {
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
}

.spoiler {
  margin-top: 8px;
  color: var(--text-dim);
  font-size: 12px;
}

.case-detail {
  margin-top: 10px;
  max-height: 320px;
  overflow-y: auto;
  line-height: 1.7;
}

.case-detail h4 {
  color: var(--accent-2);
  margin-bottom: 6px;
}

.case-sec {
  margin: 6px 0;
  font-size: 12px;
  color: var(--text);
}

.culprit {
  color: var(--danger);
  font-weight: 700;
}

.case-list {
  list-style: none;
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.case-list li {
  padding: 2px 0;
}

.case-result {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  text-align: left;
  font-size: 13px;
}
.case-result-title {
  color: var(--accent-2);
  font-weight: 600;
  margin-bottom: 6px;
}
.case-result-sec {
  color: var(--text-dim);
  margin: 6px 0 2px;
}

.evidence-desc {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.inv-item .evidence-desc {
  margin-bottom: 4px;
}

.block h3 {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}

.scene-list,
.person-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.scene-btn,
.person-btn {
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  transition: all 0.15s;
}

.scene-btn:hover:not(:disabled),
.person-btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.scene-btn.active {
  border-color: var(--accent);
  color: var(--accent-2);
  background: rgba(212, 161, 44, 0.12);
}

.scene-btn em,
.person-btn em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-dim);
  margin-left: 4px;
}

.person-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
}

.slot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  padding: 6px 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.slot-label {
  color: var(--text-dim);
}

.slot-value {
  font-weight: 600;
  flex: 1;
  text-align: right;
}

.slot-btn {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  background: var(--panel);
  transition: all 0.15s;
}

.slot-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
}

.slot-btn.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.inv {
  list-style: none;
}

.inv-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  font-size: 14px;
}

.inv-item .is-equipped {
  color: var(--accent-2);
}

.clue-list {
  max-height: 260px;
  overflow-y: auto;
}

.clue-item {
  padding: 6px 0;
  border-bottom: 1px dashed var(--border);
}

.clue-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}

.clue-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}

.tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.tag.ok {
  color: #2ea043;
  border-color: #2ea04355;
}

.tag.bad {
  color: var(--danger);
  border-color: #e5484d55;
}

.dim {
  color: var(--text-dim);
  font-size: 13px;
}

.tip {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 6px;
}

.main-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg.user {
  align-self: flex-end;
  max-width: 75%;
}

.user-bubble {
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 10px 16px;
  border-radius: 12px 12px 4px 12px;
}

.narrative {
  max-width: 100%;
  white-space: pre-wrap;
  line-height: 1.75;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.choice {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  transition: all 0.15s;
}

.choice:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-2);
}

.effects {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.effects span {
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(212, 161, 44, 0.12);
  color: var(--accent-2);
  border: 1px solid rgba(212, 161, 44, 0.3);
}

.typing {
  color: var(--text-dim);
  font-style: italic;
  animation: blink 1.2s infinite;
}

@keyframes blink {
  50% {
    opacity: 0.4;
  }
}

.ending {
  text-align: center;
  padding: 20px;
  font-size: 16px;
  border-radius: 12px;
  border: 1px dashed var(--border);
}

.ending.win {
  color: #2ea043;
  border-color: #2ea04366;
}

.ending.lose {
  color: var(--danger);
  border-color: #e5484d66;
}

.input-bar {
  border-top: 1px solid var(--border);
  padding: 16px 28px;
  background: var(--panel);
}

.error.inline {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 14px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.action-row .tip {
  margin: 0;
}

.accuse-panel,
.confront-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--panel-2);
}

.suspect-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.suspect-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 14px;
}

.suspect-btn.active {
  border-color: var(--danger);
  color: #ff6b6b;
  background: rgba(229, 72, 77, 0.1);
}

.suspect-btn em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-dim);
}

.confront-title {
  font-size: 13px;
  color: var(--text);
  margin-bottom: 8px;
  line-height: 1.6;
}

.confront-title em {
  font-style: normal;
  color: var(--text-dim);
  font-size: 12px;
}

.clue-pick {
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.clue-opt {
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 13px;
}

.clue-opt.picked {
  background: rgba(212, 161, 44, 0.12);
}

.clue-opt label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  line-height: 1.5;
}

.clue-opt input {
  margin-top: 3px;
}

.btn {
  padding: 12px 22px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.btn.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #1a1303;
}

.btn.danger {
  background: linear-gradient(135deg, #b3262b, #e5484d);
  color: #fff;
}

.btn.ghost {
  padding: 6px 12px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  font-size: 13px;
}

.btn.full {
  width: 100%;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.input-row {
  display: flex;
  gap: 10px;
}

.input-row input {
  flex: 1;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  outline: none;
  font-size: 15px;
}

.input-row input:focus {
  border-color: var(--accent);
}

.restart-row {
  margin-top: 12px;
  text-align: center;
}

@media (max-width: 780px) {
  .game {
    grid-template-columns: 1fr;
  }
  .side-panel {
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 45vh;
  }
}
</style>
