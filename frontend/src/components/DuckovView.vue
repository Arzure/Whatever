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
          <span class="med">+{{ hud.medkits }} 医疗包(H)</span>
          <span class="exit-t" :class="{ danger: hud.exitT < 30 }">撤离 {{ Math.ceil(hud.exitT) }}s</span>
          <span v-if="hud.hasKey" class="key">🔑</span>
          <span v-if="hud.blackout" class="blackout">⚡ 断电中</span>
        </div>
        <div class="hud-bottom">
          <span>体力 {{ Math.round(hud.stamina) }}/100</span>
          <div class="stamina-bar"><div class="stamina-fill" :style="{ width: hud.stamina + '%' }"></div></div>
          <span class="tip">WASD 移动 · 鼠标射击 · Shift 冲刺 · E 搜刮 · 1/2/3/4 切枪 · H 医疗包 · Tab 背包</span>
        </div>
      </div>
      <!-- 局内背包 -->
      <div v-if="panel === 'playing' && bagOpen && hud" class="bag-panel">
        <h3>背包 <span class="bag-sum">总价值 {{ hud.value }} · 负重 {{ hud.bag }}/{{ hud.bagSize }}</span></h3>
        <p v-if="!bagItems.length" class="bag-empty">空空如也——去搜刮机柜吧</p>
        <div v-for="(it, i) in bagItems" :key="i" class="bag-item">
          <span class="item-icon" :class="'icon-' + it.id" :style="{ '--ic': it.color }"></span>
          <span class="bi-name">{{ it.name }}</span>
          <span class="bi-val">{{ it.value }}</span>
          <span class="bi-size">体积 {{ it.size }}</span>
          <button class="bi-drop" @click="dropItem(i)">丢弃</button>
        </div>
        <p class="bag-tip">Tab 关闭 · 丢弃低价值物品可提升移速</p>
      </div>
      <!-- 开始面板 -->
      <div v-if="panel === 'ready'" class="panel">
        <h1>撤离协议</h1>
        <p class="sub">运维封锁区 · 搜打撤</p>
        <div class="brief">
          <p>你是潜入封锁机房的运维佣兵。搜刮物资，在断电前抵达撤离点。</p>
          <p>· 开枪与开箱产生噪音，引来巡逻进程调查</p>
          <p>· 背包越满移速越慢；死亡将掉落本局全部物资</p>
          <p>· 撤离成功后物资存入仓库，可变卖换金币</p>
        </div>
        <div class="ready-btns">
          <button class="btn" @click="start">进入封锁区</button>
          <button class="btn btn2" @click="modal = 'stash'">仓库</button>
          <button class="btn btn2" @click="modal = 'shop'">商店</button>
          <button class="btn btn2" @click="modal = 'loadout'">出击配置</button>
        </div>
        <p class="ready-info">💰 {{ stash.coins }} 金币 · 仓库 {{ stash.items.length }} 件 · 携带医疗包 {{ loadoutMedkits }}/{{ medkitCount(stash) }} · 出击 {{ stash.raids }} 次 · 撤离 {{ stash.extracts }} 次</p>
      </div>
      <!-- 结算面板 -->
      <div v-else-if="panel === 'end'" class="panel">
        <h1 :class="result.win ? 'win' : 'lose'">{{ result.win ? '撤离成功' : '任务失败' }}</h1>
        <p class="sub">{{ result.msg }}</p>
        <div class="stats">
          <span>击杀 {{ result.kills }}</span>
          <span>存活 {{ Math.floor(result.time) }}s</span>
          <span>带出 {{ result.value }}</span>
        </div>
        <div class="ready-btns">
          <button class="btn" @click="panel = 'ready'">返回仓库</button>
        </div>
      </div>
      <!-- 仓库弹窗 -->
      <div v-if="modal === 'stash'" class="modal-mask" @click.self="modal = null">
        <div class="modal">
          <h2>仓库 <button class="modal-x" @click="modal = null">✕</button></h2>
          <p class="modal-sub">💰 {{ stash.coins }} 金币 · 存货 {{ stash.items.length }} 件</p>
          <div class="stash-grid">
            <div v-for="(it, i) in stash.items" :key="i" class="stash-card">
              <span class="item-icon big" :class="'icon-' + it.id" :style="{ '--ic': it.color }"></span>
              <b>{{ it.name }}</b>
              <em>{{ it.value }} 金币</em>
              <button class="sell-btn" @click="doSell(i)">变卖</button>
            </div>
            <p v-if="!stash.items.length" class="bag-empty">仓库空空如也——去封锁区搜刮吧</p>
          </div>
          <button class="btn btn2" @click="doSellAll">一键变卖全部战利品</button>
          <p v-if="msg" class="shop-msg">{{ msg }}</p>
        </div>
      </div>
      <!-- 商店弹窗 -->
      <div v-if="modal === 'shop'" class="modal-mask" @click.self="modal = null">
        <div class="modal">
          <h2>商店 <button class="modal-x" @click="modal = null">✕</button></h2>
          <p class="modal-sub">💰 {{ stash.coins }} 金币</p>
          <div class="shop-grid">
            <div v-for="it in SHOP.weapons" :key="it.id" class="shop-item">
              <span class="item-icon big" :class="'icon-' + it.id"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.weapons.includes(it.id) || stash.coins < it.price" @click="doBuy('weapons', it.id)">{{ stash.weapons.includes(it.id) ? '已拥有' : it.price + ' 金币' }}</button>
            </div>
            <div v-for="it in SHOP.armors" :key="it.id" class="shop-item">
              <span class="item-icon big" :class="'icon-' + it.id"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.armor === it.id || stash.coins < it.price" @click="doBuy('armors', it.id)">{{ stash.armor === it.id ? '已装备' : it.price + ' 金币' }}</button>
            </div>
            <div v-for="it in SHOP.upgrades" :key="it.id" class="shop-item">
              <span class="item-icon big icon-bag"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.bagLv >= ['bag1','bag2','bag3'].indexOf(it.id) + 1 || stash.coins < it.price" @click="doBuy('upgrades', it.id)">{{ stash.bagLv >= ['bag1','bag2','bag3'].indexOf(it.id) + 1 ? '已购买' : it.price + ' 金币' }}</button>
            </div>
            <div v-for="it in SHOP.supplies" :key="it.id" class="shop-item">
              <span class="item-icon big icon-medkit"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.coins < it.price" @click="doBuy('supplies', it.id)">{{ it.price }} 金币</button>
            </div>
          </div>
          <p v-if="msg" class="shop-msg">{{ msg }}</p>
        </div>
      </div>
      <!-- 出击配置弹窗 -->
      <div v-if="modal === 'loadout'" class="modal-mask" @click.self="modal = null">
        <div class="modal">
          <h2>出击配置 <button class="modal-x" @click="modal = null">✕</button></h2>
          <p class="modal-sub">从仓库携带消耗品进入封锁区</p>
          <div class="loadout-row">
            <span class="item-icon big icon-medkit"></span>
            <div class="loadout-info">
              <b>纳米医疗包</b>
              <em>局内按 H 恢复 50 HP · 仓库存量 {{ medkitCount(stash) }}</em>
            </div>
            <div class="loadout-ctrl">
              <button class="buy-btn" @click="loadoutMedkits = Math.max(0, loadoutMedkits - 1)">−</button>
              <span class="loadout-num">{{ loadoutMedkits }}</span>
              <button class="buy-btn" @click="loadoutMedkits = Math.min(medkitCount(stash), loadoutMedkits + 1)">＋</button>
            </div>
          </div>
          <p class="modal-sub">已购武器（全部随身携带）：{{ stash.weapons.map(w => WEAPONS[w] ? WEAPONS[w].name : w).join(' / ') }}{{ stash.armor ? ' · 护甲：' + (stash.armor === 'light' ? '轻量防火板' : '重型机柜装甲') : '' }} · 背包容量 {{ 10 + stash.bagLv * 4 }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { DuckovGame, WEAPONS } from '../game/duckov/game.js';
import { render } from '../game/duckov/renderer.js';
import { sound } from '../game/audio.js';
import { loadStash, bankStash, failStash, buy, sellItem, sellAllLoot, medkitCount, consumeMedkits, bagCapacity, armorMul, SHOP } from '../game/duckov/stash.js';

const canvasRef = ref(null);
const stageRef = ref(null);
const panel = ref('ready');
const hud = ref(null);
const result = ref({});
const bagOpen = ref(false);
let game = null;

const stash = ref(loadStash());
const modal = ref(null);
const msg = ref('');
const loadoutMedkits = ref(0);
const bagItems = ref([]);

function doBuy(kind, id) {
  const r = buy(stash.value, kind, id);
  msg.value = r.msg;
  if (r.ok) sound.play('levelup');
  stash.value = { ...stash.value };
}

function doSell(i) {
  const r = sellItem(stash.value, i);
  msg.value = r.msg;
  if (r.ok) sound.play('pickup');
  stash.value = { ...stash.value };
}

function doSellAll() {
  const r = sellAllLoot(stash.value);
  msg.value = r.msg;
  if (r.ok) sound.play('levelup');
  stash.value = { ...stash.value };
}

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
  const takeMedkits = Math.min(loadoutMedkits.value, medkitCount(stash.value));
  consumeMedkits(stash.value, takeMedkits);
  stash.value = { ...stash.value };
  panel.value = 'playing';
  hud.value = null;
  bagOpen.value = false;
  modal.value = null;
  fit();
  if (game) game.stop();
  game = new DuckovGame(canvasRef.value, {
    onEnd: (r) => {
      result.value = r;
      panel.value = 'end';
      if (r.win) bankStash(stash.value, game.player.bag, game.medkits);
      else failStash(stash.value);
      stash.value = { ...stash.value };
    },
    onHud: (h) => { hud.value = h; }
  });
  game.renderer = render;
  game.start({
    bagSize: bagCapacity(stash.value),
    armorMul: armorMul(stash.value),
    weapons: stash.value.weapons,
    medkits: takeMedkits
  });
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
  if (k === 'escape') { modal.value = null; return; }
  if (!game || game.state !== 'playing') return;
  game.keys[k] = true;
  if (k === 'shift' && game.player.stamina > 25 && game.player.dashCd <= 0) {
    game.player.dashT = 0.22;
    game.player.dashCd = 0.9;
    game.player.stamina -= 25;
  }
  if (k === 'h') game.useMedkit();
  if (k === '1') game.player.weapon = 'pistol';
  if (k === '2' && game.ownedWeapons.includes('smg')) game.player.weapon = 'smg';
  if (k === '3' && game.ownedWeapons.includes('shotgun')) game.player.weapon = 'shotgun';
  if (k === '4' && game.ownedWeapons.includes('railgun')) game.player.weapon = 'railgun';
  if (k === ' ') ev.preventDefault();
}

function onKeyUp(ev) {
  if (!game) return;
  game.keys[ev.key.toLowerCase()] = false;
}

function onBlur() {
  if (game) game.keys = {};
}

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
.hud-top .med { color: #f87171; }
.hud-top .exit-t { color: #f87171; font-weight: bold; }
.hud-top .exit-t.danger { animation: blink 0.6s infinite; }
.hud-top .key { color: #fde047; }
.hud-top .blackout { color: #f87171; animation: blink 0.4s infinite; }
.hud-bottom { position: absolute; bottom: 0; left: 0; right: 0; display: flex; gap: 10px; padding: 10px 16px; background: linear-gradient(transparent, rgba(5,7,13,0.85)); color: #94a3b8; font-size: 12px; align-items: center; }
.stamina-bar { width: 120px; height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; }
.stamina-fill { height: 100%; background: #22d3ee; transition: width 0.1s; }
.tip { margin-left: auto; color: #475569; }
.panel { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(5,7,13,0.92); color: #e2e8f0; font-family: monospace; text-align: center; padding: 20px; overflow-y: auto; }
.panel h1 { font-size: 42px; margin: 0 0 6px; color: #67e8f9; text-shadow: 0 0 24px rgba(34,211,238,0.5); }
.panel h1.win { color: #4ade80; }
.panel h1.lose { color: #f87171; }
.sub { color: #94a3b8; margin: 0 0 18px; }
.brief { max-width: 480px; text-align: left; color: #cbd5e1; font-size: 13px; line-height: 1.9; margin-bottom: 24px; border: 1px solid #1e3a5f; padding: 14px 18px; border-radius: 8px; background: rgba(15,23,42,0.6); }
.ready-btns { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.ready-info { color: #fde047; font-size: 12px; margin-top: 16px; }
.btn { pointer-events: auto; background: #164e63; color: #67e8f9; border: 1px solid #22d3ee; padding: 12px 42px; font-size: 16px; font-family: monospace; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
.btn:hover { background: #0e7490; box-shadow: 0 0 18px rgba(34,211,238,0.4); }
.btn2 { background: #1e293b; border-color: #64748b; color: #cbd5e1; font-size: 14px; padding: 12px 28px; }
.btn2:hover { background: #334155; box-shadow: none; }
.stats { display: flex; gap: 24px; color: #fde047; margin-bottom: 22px; font-size: 15px; }
/* 弹窗 */
.modal-mask { position: absolute; inset: 0; background: rgba(2,4,10,0.7); display: flex; align-items: center; justify-content: center; z-index: 10; }
.modal { background: #0b1220; border: 1px solid #1e3a5f; border-radius: 12px; padding: 20px 24px; max-width: 640px; width: 92%; max-height: 82vh; overflow-y: auto; font-family: monospace; color: #e2e8f0; box-shadow: 0 0 40px rgba(34,211,238,0.15); }
.modal h2 { margin: 0 0 8px; color: #67e8f9; font-size: 20px; display: flex; justify-content: space-between; align-items: center; }
.modal-x { background: transparent; border: none; color: #64748b; font-size: 18px; cursor: pointer; }
.modal-x:hover { color: #f87171; }
.modal-sub { color: #94a3b8; font-size: 12px; margin: 0 0 14px; }
/* 仓库 */
.stash-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.stash-card { border: 1px solid #1e3a5f; border-radius: 8px; padding: 10px 8px; background: rgba(15,23,42,0.6); display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; }
.stash-card b { color: #e2e8f0; font-size: 12px; }
.stash-card em { color: #fde047; font-style: normal; font-size: 11px; }
.sell-btn { background: #422006; color: #fbbf24; border: 1px solid #b45309; border-radius: 4px; padding: 3px 12px; font-size: 11px; cursor: pointer; font-family: monospace; }
.sell-btn:hover { background: #b45309; color: #fff; }
/* 商店 */
.shop-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.shop-item { border: 1px solid #1e3a5f; border-radius: 8px; padding: 10px; background: rgba(15,23,42,0.6); display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.shop-item b { color: #67e8f9; font-size: 13px; }
.shop-item em { color: #64748b; font-size: 11px; font-style: normal; flex: 1; }
.buy-btn { background: #164e63; color: #67e8f9; border: 1px solid #22d3ee; border-radius: 4px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: monospace; }
.buy-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.shop-msg { color: #4ade80; font-size: 12px; margin: 12px 0 0; text-align: center; }
/* 出击配置 */
.loadout-row { display: flex; align-items: center; gap: 14px; border: 1px solid #1e3a5f; border-radius: 8px; padding: 12px 16px; background: rgba(15,23,42,0.6); margin-bottom: 14px; }
.loadout-info { flex: 1; text-align: left; }
.loadout-info b { color: #f87171; display: block; font-size: 14px; }
.loadout-info em { color: #64748b; font-style: normal; font-size: 11px; }
.loadout-ctrl { display: flex; align-items: center; gap: 10px; }
.loadout-num { color: #fde047; font-size: 18px; min-width: 24px; text-align: center; }
/* 局内背包 */
.bag-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 400px; max-height: 70vh; overflow-y: auto; background: rgba(8,12,20,0.96); border: 1px solid #1e3a5f; border-radius: 10px; padding: 16px 18px; font-family: monospace; color: #e2e8f0; pointer-events: auto; box-shadow: 0 0 30px rgba(34,211,238,0.15); }
.bag-panel h3 { margin: 0 0 12px; color: #67e8f9; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
.bag-sum { font-size: 12px; color: #fde047; font-weight: normal; }
.bag-empty { color: #64748b; font-size: 13px; text-align: center; padding: 20px 0; grid-column: 1 / -1; }
.bag-item { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid rgba(30,58,95,0.5); font-size: 13px; }
.bi-name { flex: 1; }
.bi-val { color: #fde047; font-size: 12px; }
.bi-size { color: #94a3b8; font-size: 12px; }
.bi-drop { background: transparent; border: 1px solid #7f1d1d; color: #f87171; font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-family: monospace; }
.bi-drop:hover { background: #7f1d1d; }
.bag-tip { margin: 10px 0 0; color: #475569; font-size: 11px; text-align: center; }
/* —— CSS 绘制物品图标（无素材依赖） —— */
.item-icon { width: 22px; height: 22px; flex-shrink: 0; position: relative; display: inline-block; }
.item-icon.big { width: 44px; height: 44px; }
.item-icon::before, .item-icon::after { content: ''; position: absolute; box-sizing: border-box; }
/* 内存条：绿色电路板 + 金手指 */
.icon-ram::before { inset: 4% 15%; background: #14532d; border: 1.5px solid #22c55e; border-radius: 2px; box-shadow: 0 0 8px rgba(34,197,94,0.6); }
.icon-ram::after { left: 20%; right: 20%; bottom: -4%; height: 8%; background: repeating-linear-gradient(90deg, #fde047 0 2px, transparent 2px 5px); }
/* 硬盘：银色圆盘 + 中心轴 */
.icon-disk::before { inset: 8%; background: radial-gradient(circle, #e2e8f0 30%, #64748b 70%); border-radius: 50%; border: 1.5px solid #cbd5e1; box-shadow: 0 0 8px rgba(203,213,225,0.5); }
.icon-disk::after { left: 42%; top: 42%; width: 16%; height: 16%; background: #0f172a; border-radius: 50%; }
/* GPU：双风扇显卡 */
.icon-gpu::before { inset: 10% 4%; background: #052e16; border: 1.5px solid #22c55e; border-radius: 3px; box-shadow: 0 0 10px rgba(34,197,94,0.5); }
.icon-gpu::after { left: 12%; top: 22%; width: 34%; height: 56%; background: radial-gradient(circle, #86efac 30%, #166534 70%); border-radius: 50%; border: 1px solid #4ade80; box-shadow: 52px 0 0 0 radial-gradient(circle, #86efac 30%, #166534 70%); }
/* 量子核心：发光多棱晶体 */
.icon-core::before { inset: 12%; background: #fde047; clip-path: polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%); box-shadow: 0 0 14px rgba(253,224,71,0.9); }
.icon-core::after { left: 38%; top: 30%; width: 24%; height: 24%; background: #fffbeb; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
/* 医疗包：红十字 */
.icon-medkit::before { inset: 8%; background: #1c0a0a; border: 1.5px solid #f87171; border-radius: 4px; box-shadow: 0 0 10px rgba(248,113,113,0.6); }
.icon-medkit::after { left: 42%; top: 25%; width: 16%; height: 50%; background: #f87171; box-shadow: 0 0 0 8px transparent; }
.icon-medkit::after { box-shadow: -8px 0 0 #f87171, 8px 0 0 #f87171; clip-path: none; }
/* 武器图标 */
.icon-smg::before { inset: 20% 4% 40% 30%; background: #78350f; border: 1.5px solid #fbbf24; border-radius: 2px; box-shadow: 0 6px 0 -2px #78350f, 0 6px 0 -0.5px #fbbf24; }
.icon-smg::after { left: 4%; top: 45%; width: 30%; height: 12%; background: #fbbf24; border-radius: 2px; }
.icon-shotgun::before { inset: 30% 4% 30% 40%; background: #831843; border: 1.5px solid #f472b6; border-radius: 2px; box-shadow: 0 10px 0 -3px #831843; }
.icon-shotgun::after { left: 4%; top: 35%; width: 40%; height: 30%; background: #f472b6; clip-path: polygon(20% 0, 100% 20%, 100% 80%, 20% 100%); }
.icon-railgun::before { inset: 35% 4% 35% 35%; background: #4c1d95; border: 1.5px solid #c084fc; border-radius: 2px; box-shadow: 0 0 10px rgba(192,132,252,0.7); }
.icon-railgun::after { left: 10%; top: 45%; width: 55%; height: 10%; background: #e9d5ff; box-shadow: 0 0 8px #c084fc; }
/* 护甲图标 */
.icon-light::before, .icon-heavy::before { inset: 12% 22%; background: #334155; border: 1.5px solid #94a3b8; clip-path: polygon(50% 0, 100% 18%, 100% 70%, 50% 100%, 0 70%, 0 18%); box-shadow: 0 0 8px rgba(148,163,184,0.5); }
.icon-light::after, .icon-heavy::after { left: 40%; top: 35%; width: 20%; height: 30%; background: #cbd5e1; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
.icon-heavy::before { background: #1e293b; border-color: #e2e8f0; box-shadow: 0 0 12px rgba(226,232,240,0.6); }
/* 背包扩容图标 */
.icon-bag::before { inset: 18% 25%; background: #422006; border: 1.5px solid #fbbf24; border-radius: 4px 4px 8px 8px; box-shadow: 0 0 8px rgba(251,191,36,0.5); }
.icon-bag::after { left: 38%; top: 8%; width: 24%; height: 14%; background: transparent; border: 1.5px solid #fbbf24; border-bottom: none; border-radius: 6px 6px 0 0; }
@keyframes blink { 50% { opacity: 0.3; } }
</style>
