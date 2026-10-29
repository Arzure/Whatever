<template>
  <div class="duckov-wrap notranslate" translate="no">
    <div class="stage" ref="stageRef">
      <canvas ref="canvasRef"></canvas>
      <!-- HUD -->
      <div v-if="hud" class="hud">
        <div class="hud-top">
          <span class="hp">HP {{ hud.hp | 0 }}/{{ hud.maxHp }}</span>
          <span class="weapon">{{ hud.weapon }} [{{ hud.ammo }}]</span>
          <span class="bag">背包 {{ hud.bag }}/{{ hud.bagSize }} · 价值 {{ hud.value }}</span>
          <span class="exit-t" :class="{ danger: hud.exitT < 30 }">撤离倒计时 {{ Math.ceil(hud.exitT) }}s</span>
          <span v-if="hud.hasKey" class="key">🔑 钥匙卡</span>
          <span v-if="hud.blackout" class="blackout">⚡ 断电中</span>
        </div>
        <div class="hud-bottom">
          <span>体力</span>
          <div class="stamina-bar"><div class="stamina-fill" :style="{ width: hud.stamina + '%' }"></div></div>
          <span class="tip">WASD 移动 · 鼠标射击 · Shift 冲刺 · E 搜刮 · 1/2/3 切枪 · Tab 背包</span>
        </div>
      </div>
      <!-- 背包界面（Tab 开关） -->
      <div v-if="panel === 'playing' && bagOpen && hud" class="bag-panel">
        <h3>背包 <span class="bag-sum">总价值 {{ hud.value }} · 负重 {{ hud.bag }}/{{ hud.bagSize }}</span></h3>
        <p v-if="!bagItems.length" class="bag-empty">空空如也——去搜刮机柜吧</p>
        <div v-for="(it, i) in bagItems" :key="i" class="bag-item">
          <span class="bi-dot" :style="{ background: it.color }"></span>
          <span class="bi-name">{{ it.name }}</span>
          <span class="bi-val">价值 {{ it.value }}</span>
          <span class="bi-size">体积 {{ it.size }}</span>
          <button class="bi-drop" @click="dropItem(i)">丢弃</button>
        </div>
        <p class="bag-tip">Tab 关闭 · 丢弃低价值物品可提升移速</p>
      </div>
      <!-- 开始面板 -->
      <div v-if="panel === 'ready'" class="panel">
        <h1>逃离鹅科夫</h1>
        <p class="sub">运维封锁区 · 搜打撤</p>
        <div class="brief">
          <p>你是一只潜入封锁机房的鹅佣兵。搜刮物资，在断电前抵达撤离点。</p>
          <p>· 开枪与开箱会产生噪音，引来巡逻进程调查</p>
          <p>· 背包越满移速越慢；死亡将掉落本局全部物资</p>
          <p>· 金库由防火墙核心把守，击杀精英守卫可掉落钥匙卡</p>
          <p>· 随机断电事件：全图黑暗，敌人同样失明——逃跑窗口</p>
        </div>
        <button class="btn" @click="start">进入封锁区</button>
      </div>
      <!-- 结算面板 -->
      <div v-else-if="panel === 'end'" class="panel">
        <h1 :class="result.win ? 'win' : 'lose'">{{ result.win ? '撤离成功' : '任务失败' }}</h1>
        <p class="sub">{{ result.msg }}</p>
        <div class="stats">
          <span>击杀 {{ result.kills }}</span>
          <span>存活 {{ Math.floor(result.time) }}s</span>
          <span>物资价值 {{ result.value }}</span>
        </div>
        <button class="btn" @click="start">再战一局</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { DuckovGame, WEAPONS } from '../game/duckov/game.js';
import { render } from '../game/duckov/renderer.js';
import { sound } from '../game/audio.js';

const canvasRef = ref(null);
const stageRef = ref(null);
const panel = ref('ready');
const hud = ref(null);
const result = ref({});
const bagOpen = ref(false);
let game = null;

const bagItems = ref([]);

function dropItem(i) {
  if (!game || !game.player) return;
  const it = game.player.bag[i];
  if (!it) return;
  game.player.bag.splice(i, 1);
  game.lootValue -= it.value;
  game.floats.push({ x: game.player.x, y: game.player.y - 40, txt: '丢弃 ' + it.name, t: 1, color: '#94a3b8' });
  bagItems.value = [...game.player.bag];
}

function fit() {
  const c = canvasRef.value;
  const s = stageRef.value;
  if (!c || !s) return;
  c.width = s.clientWidth;
  c.height = s.clientHeight;
}

function start() {
  panel.value = 'playing';
  hud.value = null;
  fit();
  if (game) game.stop();
  game = new DuckovGame(canvasRef.value, {
    onEnd: (r) => {
      result.value = r;
      panel.value = 'end';
    },
    onHud: (h) => { hud.value = h; }
  });
  game.renderer = render;
  game.start();
}

onMounted(() => {
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  const c = canvasRef.value;
  if (c) {
    c.addEventListener('mousemove', onMouseMove);
    c.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    c.addEventListener('contextmenu', onCtx);
  }
});

onBeforeUnmount(() => {
  if (game) game.stop();
  window.removeEventListener('resize', fit);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('mouseup', onMouseUp);
  const c = canvasRef.value;
  if (c) {
    c.removeEventListener('mousemove', onMouseMove);
    c.removeEventListener('mousedown', onMouseDown);
    c.removeEventListener('contextmenu', onCtx);
  }
});

function onMouseMove(ev) {
  if (!game) return;
  const r = canvasRef.value.getBoundingClientRect();
  game.mouse.x = ev.clientX - r.left;
  game.mouse.y = ev.clientY - r.top;
}

function onMouseDown(ev) {
  if (!game || game.state !== 'playing') return;
  if (ev.button === 0) game.mouse.down = true;
}

function onMouseUp() {
  if (game) game.mouse.down = false;
}

function onCtx(ev) { ev.preventDefault(); }

function onKeyDown(ev) {
  const k = ev.key.toLowerCase();
  if (k === 'tab') {
    ev.preventDefault();
    if (panel.value === 'playing') {
      bagOpen.value = !bagOpen.value;
      if (bagOpen.value && game) bagItems.value = [...game.player.bag];
    }
    return;
  }
  if (!game || game.state !== 'playing') return;
  game.keys[k] = true;
  if (k === 'shift' && game.player.stamina > 25 && game.player.dashCd <= 0) {
    game.player.dashT = 0.22;
    game.player.dashCd = 0.9;
    game.player.stamina -= 25;
  }
  if (k === '1') game.player.weapon = 'pistol';
  if (k === '2') game.player.weapon = 'smg';
  if (k === '3') game.player.weapon = 'shotgun';
  if (k === ' ') ev.preventDefault();
}

function onKeyUp(ev) {
  if (!game) return;
  game.keys[ev.key.toLowerCase()] = false;
}

function onBlur() {
  if (game) game.keys = {};
}
</script>

<style scoped>
.duckov-wrap { position: fixed; inset: 0; background: #05070d; display: flex; }
.stage { position: relative; flex: 1; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
.hud { position: absolute; inset: 0; pointer-events: none; font-family: monospace; }
.hud-top { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 18px; padding: 10px 16px; background: linear-gradient(rgba(5,7,13,0.85), transparent); color: #e2e8f0; font-size: 13px; align-items: center; }
.hud-top .hp { color: #4ade80; font-weight: bold; }
.hud-top .weapon { color: #67e8f9; }
.hud-top .bag { color: #fde047; }
.hud-top .exit-t { color: #f87171; font-weight: bold; }
.hud-top .exit-t.danger { animation: blink 0.6s infinite; }
.hud-top .key { color: #fde047; }
.hud-top .blackout { color: #f87171; animation: blink 0.4s infinite; }
.hud-bottom { position: absolute; bottom: 0; left: 0; right: 0; display: flex; gap: 10px; padding: 10px 16px; background: linear-gradient(transparent, rgba(5,7,13,0.85)); color: #94a3b8; font-size: 12px; align-items: center; }
.stamina-bar { width: 120px; height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; }
.stamina-fill { height: 100%; background: #22d3ee; transition: width 0.1s; }
.tip { margin-left: auto; color: #475569; }
.bag-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 380px; max-height: 70vh; overflow-y: auto; background: rgba(8,12,20,0.96); border: 1px solid #1e3a5f; border-radius: 10px; padding: 16px 18px; font-family: monospace; color: #e2e8f0; pointer-events: auto; box-shadow: 0 0 30px rgba(34,211,238,0.15); }
.bag-panel h3 { margin: 0 0 12px; color: #67e8f9; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
.bag-sum { font-size: 12px; color: #fde047; font-weight: normal; }
.bag-empty { color: #64748b; font-size: 13px; text-align: center; padding: 20px 0; }
.bag-item { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid rgba(30,58,95,0.5); font-size: 13px; }
.bi-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; box-shadow: 0 0 6px currentColor; }
.bi-name { flex: 1; }
.bi-val { color: #fde047; font-size: 12px; }
.bi-size { color: #94a3b8; font-size: 12px; }
.bi-drop { background: transparent; border: 1px solid #7f1d1d; color: #f87171; font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-family: monospace; }
.bi-drop:hover { background: #7f1d1d; }
.bag-tip { margin: 10px 0 0; color: #475569; font-size: 11px; text-align: center; }
.panel { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(5,7,13,0.92); color: #e2e8f0; font-family: monospace; text-align: center; padding: 20px; }
.panel h1 { font-size: 42px; margin: 0 0 6px; color: #67e8f9; text-shadow: 0 0 24px rgba(34,211,238,0.5); }
.panel h1.win { color: #4ade80; }
.panel h1.lose { color: #f87171; }
.sub { color: #94a3b8; margin: 0 0 18px; }
.brief { max-width: 480px; text-align: left; color: #cbd5e1; font-size: 13px; line-height: 1.9; margin-bottom: 24px; border: 1px solid #1e3a5f; padding: 14px 18px; border-radius: 8px; background: rgba(15,23,42,0.6); }
.btn { pointer-events: auto; background: #164e63; color: #67e8f9; border: 1px solid #22d3ee; padding: 12px 42px; font-size: 16px; font-family: monospace; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
.btn:hover { background: #0e7490; box-shadow: 0 0 18px rgba(34,211,238,0.4); }
.stats { display: flex; gap: 24px; color: #fde047; margin-bottom: 22px; font-size: 15px; }
@keyframes blink { 50% { opacity: 0.3; } }
</style>
