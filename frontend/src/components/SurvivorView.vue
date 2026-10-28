<template>
  <div class="game-view survivor-view">
    <div ref="canvasWrap" class="canvas-wrap">
      <canvas ref="canvasEl" class="game-canvas"></canvas>
    </div>

    <!-- HUD -->
    <div v-if="playing || paused || levelup" class="hud">
      <div class="hud-top">
        <div class="hud-hp">
          <div class="hud-hpbar">
            <div class="hud-hp-fill" :class="{ low: stats.hp / stats.maxHp < 0.3 }" :style="{ width: Math.max(0, stats.hp / stats.maxHp * 100) + '%' }"></div>
          </div>
          <span class="hud-hp-text">{{ Math.ceil(stats.hp) }}/{{ stats.maxHp }}</span>
        </div>
        <div class="hud-time">{{ timeText }}</div>
        <div class="hud-kills">击杀 {{ stats.kills }}</div>
        <div class="hud-gold">{{ stats.gold || 0 }} ¢</div>
        <div v-if="stats.shopIn > 0" class="hud-shopin">商店 {{ Math.ceil(stats.shopIn) }}s</div>
        <div v-if="stats.combo >= 5" class="hud-combo" :key="stats.combo">{{ stats.combo }} 连杀</div>
        <div class="hud-dash" :class="{ ready: stats.dashCd <= 0 }" :title="stats.dashCd <= 0 ? '冲刺就绪（空格）' : '冲刺冷却 ' + stats.dashCd.toFixed(1) + 's'">»</div>
      </div>
      <div v-if="stats.event" class="hud-event" :class="stats.event">{{ eventText }}</div>
      <div class="hud-xp">
        <div class="hud-xpbar"><div class="hud-xp-fill" :style="{ width: Math.min(100, stats.xp / stats.xpNeed * 100) + '%' }"></div></div>
        <span class="hud-lv">Lv {{ stats.level }}</span>
      </div>
      <div class="hud-weapons">
        <span v-for="(lv, id) in stats.weapons" :key="id" class="hud-wchip" :style="{ borderColor: weaponColor(id) }">{{ weaponName(id) }} {{ lv }}{{ stats.evolutions && stats.evolutions[id] ? '★' : '' }}</span>
        <span v-for="(lv, id) in stats.passives" :key="'p' + id" class="hud-pchip" :style="{ borderColor: passiveColor(id) }">{{ passiveName(id) }} {{ lv }}</span>
      </div>
    </div>

    <!-- 暂停按钮 -->
    <button v-if="playing" class="pause-btn" title="暂停（Esc / P）" @click="pause">‖</button>

    <!-- Music / SFX 开关 -->
    <div class="audio-btns">
      <button class="audio-btn" :class="{ off: !musicOn }" :title="musicOn ? '关闭音乐' : '开启音乐'" @click="toggleMusic">♪</button>
      <button class="audio-btn" :class="{ off: !sfxOn }" :title="sfxOn ? '关闭音效' : '开启音效'" @click="toggleSfx">♫</button>
    </div>

    <!-- 虚拟摇杆（触摸设备） -->
    <div v-if="playing && isTouch" ref="stickEl" class="vjoy" @touchstart.prevent="onStickStart" @touchmove.prevent="onStickMove" @touchend.prevent="onStickEnd">
      <div class="vjoy-base">
        <div class="vjoy-knob" :style="{ transform: 'translate(' + stickX + 'px,' + stickY + 'px)' }"></div>
      </div>
    </div>

    <!-- 升级三选一 -->
    <div v-if="levelup" class="overlay">
      <div class="panel">
        <h2>{{ chestMode ? '宝箱开启！' : '升级！Lv ' + stats.level }}</h2>
        <p class="tip">{{ chestMode ? '免费选择一项强化' : '选择一项强化' }}</p>
        <div class="choices">
          <button v-for="(c, i) in choices" :key="i" class="choice" :style="{ borderColor: c.color }" @click="pick(c)">
            <span class="choice-kind">{{ kindText(c.kind) }}</span>
            <span class="choice-name">{{ c.name }}</span>
            <span class="choice-lv">Lv {{ c.lv }}</span>
            <span class="choice-desc">{{ c.desc }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 波次商店 -->
    <div v-if="shopOpen" class="overlay">
      <div class="panel">
        <h2>补给商店</h2>
        <p class="tip">金币：{{ shopGold }} ¢</p>
        <div class="choices">
          <button v-for="(it, i) in shopItems" :key="i" class="choice" :style="{ borderColor: it.color }" :class="{ poor: shopGold < it.cost }" @click="buyItem(i)">
            <span class="choice-kind">{{ it.kind === 'curse' ? '风险' : '商品' }}</span>
            <span class="choice-name">{{ it.name }}</span>
            <span class="choice-lv">{{ it.cost }} ¢</span>
            <span class="choice-desc">{{ it.desc }}</span>
          </button>
        </div>
        <div class="shop-btns">
          <button class="play-btn small" :disabled="shopGold < 5 || shopRerolled" @click="rerollShop">重掷 5¢</button>
          <button class="play-btn small" @click="closeShop">继续战斗</button>
        </div>
      </div>
    </div>
    <!-- 暂停 -->
    <div v-if="paused" class="overlay">
      <div class="panel">
        <h2>已暂停</h2>
        <p class="final-score">存活 {{ timeText }} · 击杀 {{ stats.kills }} · Lv {{ stats.level }} · 金币 {{ stats.gold || 0 }} ¢</p>
        <div class="pause-stats">
          <span v-for="(lv, id) in stats.weapons" :key="id" class="hud-wchip" :style="{ borderColor: weaponColor(id) }">{{ weaponName(id) }} {{ lv }}{{ stats.evolutions && stats.evolutions[id] ? '★' : '' }}</span>
          <span v-for="(lv, id) in stats.passives" :key="'p' + id" class="hud-pchip" :style="{ borderColor: passiveColor(id) }">{{ passiveName(id) }} {{ lv }}</span>
          <span v-if="stats.curse" class="hud-pchip" style="border-color: #c084fc">☠ 黑暗契约 ×{{ stats.curse }}</span>
        </div>
        <div class="pause-actions">
          <button class="play-btn" @click="resume">继续</button>
          <button class="ghost-btn" @click="restart">重新开始</button>
        </div>
      </div>
    </div>

    <!-- 开始 / 结束 -->
    <div v-if="!playing && !levelup && !paused" class="overlay">
      <div class="panel">
        <h2 v-if="result.win">胜利！数据已保全</h2>
        <h2 v-else-if="over">服务器沦陷</h2>
        <h2 v-else>割草幸存者：运维之夜</h2>
        <p v-if="over || result.win" class="final-score">
          存活 {{ timeText }} · 击杀 {{ result.kills }} · Lv {{ result.level }}
        </p>
        <p v-if="(over || result.win) && best" class="tip">最佳记录：存活 {{ fmtTime(best.time) }} · 击杀 {{ best.kills }}{{ best.win ? ' · 通关' : '' }}</p>
        <p class="tip" v-else>WASD / 方向键移动，空格冲刺，主炮自动朝鼠标方向射击<br />击杀故障获取经验，升级选择强化；连续击杀有经验加成<br />精英与稀有故障掉宝箱，怪物掉落治疗包/磁铁/炸弹<br />存活 20 分钟，击败数据毁灭者即胜利</p>
        <div v-if="!over && !result.win" class="char-pick">
          <button v-for="(c, id) in CHARACTERS" :key="id" class="char-card" :class="{ sel: charId === id }" :style="{ borderColor: c.color }" @click="charId = id">
            <span class="char-name">{{ c.name }}</span>
            <span class="char-desc">{{ c.desc }}</span>
          </button>
        </div>
        <label v-if="!over && !result.win" class="daily-toggle"><input type="checkbox" v-model="daily" /> 每日挑战（按日期轮换词缀：超频/精英/匮乏之日）</label>
        <div v-if="!over && !result.win && hasSave" class="save-actions">
          <button class="play-btn" @click="continueSave">继续上次存档</button>
          <button class="ghost-btn" @click="discardSave">放弃存档</button>
        </div>
        <button class="play-btn" @click="start">{{ over || result.win ? '再来一局' : '开始游戏' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { SurvivorGame, WEAPONS, PASSIVES, CHARACTERS } from '../game/survivor.js';
import { sound } from '../game/audio.js';

const canvasEl = ref(null);
const canvasWrap = ref(null);
const stickEl = ref(null);

const playing = ref(false);
const musicOn = ref(true);
const sfxOn = ref(true);
const chestMode = ref(false);
const best = ref(null);
const paused = ref(false);
const levelup = ref(false);
const over = ref(false);
const isTouch = ref(false);
const choices = ref([]);
const charId = ref('ops');
const daily = ref(false);
const hasSave = ref(false);
const result = reactive({ win: false, kills: 0, level: 1, time: 0 });
const stats = reactive({
  hp: 100, maxHp: 100, level: 1, xp: 0, xpNeed: 5,
  time: 0, kills: 0, weapons: {}, passives: {}, evolutions: {}, combo: 0, dashCd: 0, event: null, eventT: 0,
});

let game = null;
let stickActive = false;
let stickId = null;
let stickCX = 0, stickCY = 0;
const stickX = ref(0);
const stickY = ref(0);
const STICK_R = 44;

const fmtTime = t => {
  const m = Math.floor(t / 60), s = Math.floor(t) % 60;
  return m + ':' + String(s).padStart(2, '0');
};
const timeText = computed(() => {
  const t = Math.floor(over.value || result.win ? result.time : stats.time);
  const m = Math.floor(t / 60), s = t % 60;
  return m + ':' + String(s).padStart(2, '0');
});

const weaponName = id => WEAPONS[id]?.name || id;
const weaponColor = id => WEAPONS[id]?.color || '#22d3ee';
const passiveName = id => PASSIVES[id]?.name || id;
const passiveColor = id => PASSIVES[id]?.color || '#94a3b8';
const kindText = k => (k === 'new' ? '新武器' : k === 'weapon' ? '武器强化' : '被动强化');
const eventText = computed(() => {
  if (stats.event === 'horde') return '⚠ 流量洪峰 ' + Math.ceil(stats.eventT) + 's';
  if (stats.event === 'slow') return '🔧 系统维护 ' + Math.ceil(stats.eventT) + 's';
  if (stats.event === 'doublexp') return '✦ 双倍经验 ' + Math.ceil(stats.eventT) + 's';
  return '';
});

function onStats(s) {
  Object.assign(stats, s);
}

function onLevelUp(cs) {
  chestMode.value = false;
  choices.value = cs;
  levelup.value = true;
}

function onChest(cs) {
  chestMode.value = true;
  choices.value = cs;
  levelup.value = true;
}
const shopOpen = ref(false);
const shopItems = ref([]);
const shopGold = ref(0);
const shopRerolled = ref(false);
function onShop(s) {
  shopItems.value = s.items;
  shopGold.value = s.gold;
  shopRerolled.value = !!s.rerollCost ? false : true;
  shopOpen.value = true;
}
function buyItem(i) {
  const r = game.shopBuy(i);
  if (r && r.ok) {
    shopItems.value = game.shopItems.slice();
    shopGold.value = r.gold;
  }
}
function rerollShop() {
  const r = game.shopReroll();
  if (r && r.ok) {
    shopItems.value = game.shopItems.slice();
    shopGold.value = game.gold;
    shopRerolled.value = true;
  }
}
function closeShop() {
  shopOpen.value = false;
  game.shopClose();
}

function pick(c) {
  levelup.value = false;
  game.chooseUpgrade(c);
}

function onEnd(r) {
  Object.assign(result, r);
  playing.value = false;
  over.value = !r.win;
  levelup.value = false;
  sound.stopMusic();
  SurvivorGame.clearSave();
  // 最佳成绩：存活时间优先，其次击杀
  try {
    const prev = JSON.parse(localStorage.getItem('survivor_best') || 'null');
    if (!prev || r.time > prev.time || (r.time === prev.time && r.kills > prev.kills)) {
      localStorage.setItem('survivor_best', JSON.stringify({ time: r.time, kills: r.kills, level: r.level, win: r.win }));
      best.value = { time: r.time, kills: r.kills, level: r.level, win: r.win };
    }
  } catch (e) { /* localStorage 不可用时忽略 */ }
}

function start() {
  over.value = false;
  levelup.value = false;
  paused.value = false;
  playing.value = true;
  if (game) game.daily = daily.value;
  game.start(charId.value);
  if (musicOn.value) sound.startMusic();
}
function continueSave() {
  if (!game || !SurvivorGame.hasSave()) return;
  over.value = false;
  levelup.value = false;
  paused.value = false;
  playing.value = true;
  if (game.restoreSave()) {
    hasSave.value = false;
    if (musicOn.value) sound.startMusic();
  } else {
    start();
  }
}
function discardSave() {
  SurvivorGame.clearSave();
  hasSave.value = false;
}

function toggleMusic() {
  musicOn.value = !musicOn.value;
  sound.musicOn = musicOn.value;
  if (musicOn.value && playing.value) sound.startMusic();
  else sound.stopMusic();
}

function toggleSfx() {
  sfxOn.value = !sfxOn.value;
  sound.sfxOn = sfxOn.value;
}

function restart() {
  paused.value = false;
  start();
}

function pause() {
  if (!playing.value || levelup.value) return;
  if (game) game.saveGame();
  paused.value = true;
  playing.value = false;
  game.stop();
  sound.stopMusic();
}

function resume() {
  paused.value = false;
  playing.value = true;
  game.resume();
  if (musicOn.value) sound.startMusic();
}

// 页面失焦自动暂停
function onVis() {
  if (document.hidden && playing.value) pause();
}

// ---------- 键盘输入 ----------
const keys = {};
function onKeyDown(e) {
  const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'p') {
    if (playing.value) pause();
    else if (paused.value) resume();
    return;
  }
  if (k === ' ') {
    if (game && playing.value) game.dash();
    return;
  }
  if (k === 'q') {
    if (game && playing.value) game.useUlt();
    return;
  }
  keys[k] = true;
  syncKeys();
}
function onKeyUp(e) {
  keys[e.key.toLowerCase()] = false;
  syncKeys();
}
function syncKeys() {
  if (!game) return;
  let x = 0, y = 0;
  if (keys['a'] || keys['arrowleft']) x -= 1;
  if (keys['d'] || keys['arrowright']) x += 1;
  if (keys['w'] || keys['arrowup']) y -= 1;
  if (keys['s'] || keys['arrowdown']) y += 1;
  if (!stickActive) { game.input.x = x; game.input.y = y; }
}

// ---------- 虚拟摇杆 ----------
function onStickStart(e) {
  const t = e.changedTouches[0];
  stickActive = true;
  stickId = t.identifier;
  const r = stickEl.value.getBoundingClientRect();
  stickCX = r.left + r.width / 2;
  stickCY = r.top + r.height / 2;
  moveStick(t);
}
function onStickMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) moveStick(t);
  }
}
function moveStick(t) {
  let dx = t.clientX - stickCX, dy = t.clientY - stickCY;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
  stickX.value = dx;
  stickY.value = dy;
  if (game) {
    game.input.x = dx / STICK_R;
    game.input.y = dy / STICK_R;
  }
}
function onStickEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) {
      stickActive = false;
      stickId = null;
      stickX.value = 0;
      stickY.value = 0;
      if (game) { game.input.x = 0; game.input.y = 0; }
    }
  }
}

function onMouseMove(e) {
  if (!game) return;
  const rect = canvasEl.value.getBoundingClientRect();
  game.aim(e.clientX - rect.left, e.clientY - rect.top);
}

function onResize() {
  if (game) game.resize();
}

onMounted(() => {
  isTouch.value = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  game = new SurvivorGame(canvasEl.value, {
    onStats,
    onLevelUp,
    onChest,
    onShop,
    onEnd,
  });
  canvasEl.value.addEventListener('mousemove', onMouseMove);
  try { best.value = JSON.parse(localStorage.getItem('survivor_best') || 'null'); } catch (e) { best.value = null; }
  hasSave.value = SurvivorGame.hasSave();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVis);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVis);
  if (canvasEl.value) canvasEl.value.removeEventListener('mousemove', onMouseMove);
  sound.stopMusic();
  if (game) game.stop();
});
</script>

<style scoped>
.survivor-view {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  background: #0a0e1a;
  overflow: hidden;
  user-select: none;
}
.game-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

/* HUD */
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Courier New', monospace;
}
.hud-top {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.hud-hp {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hud-hpbar {
  width: 160px;
  height: 12px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid #334155;
  border-radius: 6px;
  overflow: hidden;
}
.hud-hp-fill {
  height: 100%;
  background: linear-gradient(90deg, #22d3ee, #34d399);
  transition: width 0.15s;
}
.hud-hp-fill.low {
  background: linear-gradient(90deg, #f87171, #fb923c);
}
.hud-hp-text {
  color: #e2e8f0;
  font-size: 13px;
  text-shadow: 0 1px 2px #000;
}
.hud-time {
  margin-left: auto;
  color: #fbbf24;
  font-size: 20px;
  font-weight: bold;
  text-shadow: 0 1px 3px #000;
}
.hud-kills {
  color: #f472b6;
  font-size: 14px;
  text-shadow: 0 1px 2px #000;
}
.hud-combo {
  color: #fde047;
  font-size: 15px;
  font-weight: bold;
  text-shadow: 0 0 8px rgba(253, 224, 71, 0.6);
  animation: combo-pop 0.25s ease-out;
}
@keyframes combo-pop {
  from { transform: scale(1.6); }
  to { transform: scale(1); }
}
.hud-dash {
  color: #475569;
  font-size: 18px;
  font-weight: bold;
  text-shadow: 0 1px 2px #000;
  transition: color 0.2s;
}
.hud-dash.ready {
  color: #22d3ee;
  text-shadow: 0 0 8px rgba(34, 211, 238, 0.7);
}
.hud-event {
  position: absolute;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 1px;
  border: 1px solid;
  background: rgba(10, 14, 26, 0.8);
  white-space: nowrap;
}
.hud-event.horde { color: #f87171; border-color: #f87171; }
.hud-event.slow { color: #60a5fa; border-color: #60a5fa; }
.hud-event.doublexp { color: #2dd4bf; border-color: #2dd4bf; }
.hud-xp {
  position: absolute;
  top: 34px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.hud-xpbar {
  flex: 1;
  height: 6px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid #334155;
  border-radius: 3px;
  overflow: hidden;
}
.hud-xp-fill {
  height: 100%;
  background: linear-gradient(90deg, #2dd4bf, #22d3ee);
  transition: width 0.15s;
}
.hud-lv {
  color: #2dd4bf;
  font-size: 13px;
  font-weight: bold;
  text-shadow: 0 1px 2px #000;
}
.hud-weapons {
  position: absolute;
  bottom: 10px;
  left: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 70%;
}
.hud-wchip, .hud-pchip {
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 10px;
  background: rgba(10, 14, 26, 0.7);
  color: #e2e8f0;
  font-size: 12px;
}

.pause-btn {
  position: absolute;
  top: 56px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(10, 14, 26, 0.7);
  color: #e2e8f0;
  font-size: 16px;
  cursor: pointer;
}
.pause-btn:hover {
  border-color: #22d3ee;
}

/* Music / SFX 开关 */
.audio-btns {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 5;
}
.audio-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(10, 14, 26, 0.7);
  color: #22d3ee;
  font-size: 16px;
  cursor: pointer;
}
.audio-btn:hover {
  border-color: #22d3ee;
}
.audio-btn.off {
  color: #475569;
  text-decoration: line-through;
}

/* 虚拟摇杆 */
.vjoy {
  position: absolute;
  left: 20px;
  bottom: 20px;
  width: 120px;
  height: 120px;
  touch-action: none;
}
.vjoy-base {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid rgba(56, 80, 140, 0.6);
  background: rgba(10, 14, 26, 0.4);
  position: relative;
}
.vjoy-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  border-radius: 50%;
  background: rgba(34, 211, 238, 0.5);
  border: 2px solid #22d3ee;
}

/* 覆盖层 */
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 16, 0.82);
  z-index: 10;
}
.panel {
  text-align: center;
  padding: 32px 40px;
  border: 1px solid #334155;
  border-radius: 16px;
  background: rgba(10, 14, 26, 0.95);
  box-shadow: 0 0 40px rgba(34, 211, 238, 0.15);
  max-width: 92vw;
}
.panel h2 {
  margin: 0 0 12px;
  color: #22d3ee;
  font-family: 'Courier New', monospace;
  letter-spacing: 2px;
}
.final-score {
  color: #e2e8f0;
  font-size: 15px;
  margin: 8px 0;
}
.tip {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.8;
  margin: 8px 0 16px;
}
.play-btn {
  padding: 10px 32px;
  border-radius: 10px;
  border: 1px solid #22d3ee;
  background: rgba(34, 211, 238, 0.15);
  color: #22d3ee;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s;
}
.play-btn:hover {
  background: rgba(34, 211, 238, 0.3);
  box-shadow: 0 0 16px rgba(34, 211, 238, 0.4);
}
.ghost-btn {
  padding: 10px 24px;
  border-radius: 10px;
  border: 1px solid #475569;
  background: transparent;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
}
.ghost-btn:hover {
  border-color: #94a3b8;
  color: #e2e8f0;
}
.shop-btns {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 14px;
}
.play-btn.small {
  padding: 8px 20px;
  font-size: 14px;
}
.play-btn.small:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.choice.poor {
  opacity: 0.45;
}
.hud-gold {
  color: #fde047;
  font-weight: bold;
}
.hud-shopin {
  color: #5eead4;
}
.char-pick {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 10px 0 16px;
}
.char-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #475569;
  background: rgba(15, 23, 42, 0.6);
  cursor: pointer;
  transition: all 0.15s;
  min-width: 120px;
}
.char-card:hover {
  background: rgba(30, 41, 59, 0.8);
}
.char-card.sel {
  background: rgba(34, 211, 238, 0.12);
  box-shadow: 0 0 12px rgba(34, 211, 238, 0.3);
}
.char-name {
  color: #e2e8f0;
  font-size: 14px;
  font-weight: bold;
}
.char-desc {
  color: #94a3b8;
  font-size: 11px;
}
.pause-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin: 10px 0 14px;
  max-width: 420px;
}
.pause-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 12px;
}

/* 三选一 */
.choices {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  min-width: 280px;
}
.choice {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas: 'kind name lv' 'desc desc desc';
  gap: 2px 10px;
  padding: 10px 14px;
  text-align: left;
  border: 1px solid;
  border-radius: 10px;
  background: rgba(10, 14, 26, 0.9);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}
.choice:hover {
  transform: translateX(4px);
  box-shadow: 0 0 12px rgba(34, 211, 238, 0.25);
}
.choice-kind {
  grid-area: kind;
  color: #64748b;
  font-size: 11px;
}
.choice-name {
  grid-area: name;
  color: #e2e8f0;
  font-weight: bold;
  font-size: 15px;
}
.choice-lv {
  grid-area: lv;
  color: #2dd4bf;
  font-size: 13px;
}
.choice-desc {
  grid-area: desc;
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 640px) {
  .hud-hpbar { width: 100px; }
  .hud-time { font-size: 16px; }
  .panel { padding: 20px; }
  .choices { min-width: 240px; }
}
.daily-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 10px 0 4px;
  color: #f472b6;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}
.daily-toggle input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: #f472b6;
  cursor: pointer;
}
.save-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 8px 0 4px;
}
</style>
