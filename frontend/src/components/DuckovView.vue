<template>
  <div class="duckov-wrap notranslate" translate="no">
    <div class="stage" ref="stageRef">
      <canvas ref="canvasRef"></canvas>
      <!-- HUD -->
      <div v-if="hud" class="hud">
        <div class="hud-top">
          <span v-if="hud.hasKey" class="key">🔑</span>
          <span v-if="hud.blackout" class="blackout">⚡ 断电中</span>
        </div>
        <!-- 撤离倒计时（醒目居中） -->
        <div class="exit-countdown" :class="{ danger: hud.exitT < 30 }">⏱ {{ fmtTime(hud.exitT) }}</div>
<!-- 小地图（点击展开大图） -->
        <canvas ref="minimapRef" class="minimap" :class="{ big: mapBig }" @mousedown="onMmDown" @mousemove="onMmMove" @mouseup="onMmUp" @mouseleave="onMmUp" @click="onMmClick"></canvas>
        <!-- 左下角玩家状态栏 -->
        <div class="status-panel">
          <div class="sp-row sp-weapon">
            <span class="sp-icon" v-html="iconSvg(hud.weaponId)"></span>
            <span class="sp-weapon-name">{{ hud.weapon }}</span>
            <span class="sp-ammo">[{{ hud.ammo }}<template v-if="hud.mag !== '∞'">/{{ hud.mag }}</template>]</span>
            <span v-if="hud.reloading" class="sp-reloading">⟳ 换弹中…</span>
            <span v-else class="sp-reload-hint">R 换弹</span>
            <span v-if="hud.armorId" class="sp-icon" v-html="iconSvg(hud.armorId)"></span>
            <span v-if="hud.armor" class="sp-armor">{{ hud.armor }}</span>
          </div>
          <div v-if="hud.reloading" class="sp-reload-bar"><div class="sp-reload-fill" :style="{ width: (hud.reloadPct * 100) + '%' }"></div></div>
          <div class="sp-row">
            <span class="sp-label">HP</span>
            <div class="hp-bar"><div class="hp-fill" :class="{ low: hud.hp < 30 }" :style="{ width: Math.max(0, hud.hp / hud.maxHp * 100) + '%' }"></div></div>
            <span class="sp-num">{{ Math.round(hud.hp) }}/{{ hud.maxHp }}</span>
          </div>
          <div class="sp-row">
            <span class="sp-label">体力</span>
            <div class="stamina-bar"><div class="stamina-fill" :style="{ width: hud.stamina + '%' }"></div></div>
            <span class="sp-num">{{ Math.round(hud.stamina) }}</span>
          </div>
          <div class="sp-row sp-items">
            <span class="sp-item"><span class="sp-icon" v-html="iconSvg('medkit')"></span>×{{ hud.medkits }} <i class="sp-key">H</i></span>
            <span v-if="hud.stims" class="sp-item"><span class="sp-icon" v-html="iconSvg('stim')"></span>×{{ hud.stims }} <i class="sp-key">G</i></span>
            <span v-if="hud.emps" class="sp-item"><span class="sp-icon" v-html="iconSvg('emp')"></span>×{{ hud.emps }} <i class="sp-key">Q</i></span>
            <span class="sp-loot">💰 {{ hud.value }} · 背包 {{ hud.bag }}/{{ hud.bagSize }}</span>
          </div>
        </div>
        <div class="hud-bottom">
          <span class="tip">WASD 移动 · 鼠标射击 · R 换弹 · E 搜刮 · 1-6 切枪 · H/G/Q 道具 · Tab 背包 · Esc 暂停</span>
        </div>
      </div>
      <!-- 暂停遮罩 -->
      <div v-if="panel === 'playing' && paused" class="pause-mask">
        <h2>已暂停</h2>
        <p>按 Esc 继续</p>
      </div>
      <!-- 局内背包 -->
      <div v-if="panel === 'playing' && bagOpen && hud" class="bag-panel">
        <h3>背包 <span class="bag-sum">总价值 {{ hud.value }} · 负重 {{ hud.bag }}/{{ hud.bagSize }}</span></h3>
        <p v-if="!bagItems.length" class="bag-empty">空空如也——去搜刮机柜吧</p>
        <div class="bag-grid">
          <div v-for="(it, i) in bagItems" :key="i" class="bag-cell">
            <span class="svg-icon" v-html="iconSvg(it.id)"></span>
            <span class="bi-name">{{ it.name }}</span>
            <span class="bi-val">{{ it.value }}</span>
            <button class="bi-drop" @click="dropItem(i)">丢弃</button>
            <button class="bi-drop sb-in" @click="stashSafebox(i)">存箱</button>
          </div>
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
        <p class="ready-info">💰 {{ stash.coins }} 金币 · 仓库 {{ stash.items.length }} 件 · 携带医疗包 {{ loadoutMedkitCount(stash) }} · 出击 {{ stash.raids }} 次 · 撤离 {{ stash.extracts }} 次</p>
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
          <!-- 安全箱（死亡保留） -->
          <div class="safebox-sec">
            <p class="loadout-sec">🔐 安全箱 {{ stash.safebox.length }}/{{ safeboxCapacity(stash) }} <i class="sb-note">死亡保留 · 撤离/阵亡均带回</i></p>
            <div class="safebox-grid">
              <div v-for="(it, i) in stash.safebox" :key="'sb' + i" class="bag-cell safebox-cell">
                <span class="svg-icon" v-html="iconSvg(it.id)"></span>
                <span class="bi-name">{{ it.name }}</span>
                <span class="bi-val">{{ it.value }}</span>
                <button class="bi-drop" @click="doSafeboxOut(i)">取出</button>
              </div>
              <p v-if="!stash.safebox.length" class="bag-empty">空——在下方仓库物品中点『存箱』放入</p>
            </div>
          </div>
          <!-- 已拥有武器/护甲（免费运维手枪不显示） -->
          <div v-if="ownedGear.length" class="stash-gear">
            <div v-for="g in ownedGear" :key="g.id" class="stash-card gear">
              <span class="svg-icon" v-html="iconSvg(g.id)"></span>
              <b>{{ g.name }}</b>
              <em>{{ g.tag }}</em>
            </div>
          </div>
          <div class="stash-grid">
            <div v-for="(it, i) in stash.items" :key="i" class="stash-card">
              <span class="svg-icon" v-html="iconSvg(it.id)"></span>
              <b>{{ it.name }}</b>
              <em>{{ it.value }} 金币</em>
              <button class="sell-btn" @click="doSafeboxIn(i)">存箱</button>
              <button class="sell-btn" @click="doSell(i)">变卖</button>
            </div>
            <p v-if="!stash.items.length" class="bag-empty">仓库空空如也——去封锁区搜刮吧</p>
          </div>
          <!-- 整机合成台 -->
          <div class="synth-sec">
            <p class="loadout-sec">🖥️ 整机合成台 <i class="sb-note">凑齐同档 8 大部件且 CPU 与主板平台一致 · 合成价 = 散件总价 × 档位倍率</i></p>
            <div v-for="row in synthRows" :key="row.tier" class="synth-row" :class="{ ready: row.ready }">
              <b class="synth-tier">{{ row.name }}</b>
              <span v-for="(n, c) in row.have" :key="c" class="synth-cat" :class="{ ok: n > 0 }">{{ PART_CATS[c] }}×{{ n }}</span>
              <em v-if="row.have.mb > 0 && !row.mbOk" class="synth-warn">平台不符</em>
              <button class="buy-btn" :disabled="!row.ready" @click="doSynth">{{ row.ready ? '合成（×' + PC_MULT[row.tier] + '）' : '缺 ' + row.missing.length + ' 件' }}</button>
            </div>
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
              <span class="svg-icon" v-html="iconSvg(it.id)"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.weapons.includes(it.id) || stash.coins < it.price" @click="doBuy('weapons', it.id)">{{ stash.weapons.includes(it.id) ? '已拥有' : it.price + ' 金币' }}</button>
            </div>
            <div v-for="it in SHOP.armors" :key="it.id" class="shop-item">
              <span class="svg-icon" v-html="iconSvg(it.id)"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.armor === it.id || stash.coins < it.price" @click="doBuy('armors', it.id)">{{ stash.armor === it.id ? '已装备' : it.price + ' 金币' }}</button>
            </div>
            <div v-for="it in SHOP.upgrades" :key="it.id" class="shop-item">
              <span class="svg-icon" v-html="iconSvg('bag')"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.bagLv >= ['bag1','bag2','bag3'].indexOf(it.id) + 1 || stash.coins < it.price" @click="doBuy('upgrades', it.id)">{{ stash.bagLv >= ['bag1','bag2','bag3'].indexOf(it.id) + 1 ? '已购买' : it.price + ' 金币' }}</button>
            </div>
            <div v-for="it in SHOP.supplies" :key="it.id" class="shop-item">
              <span class="svg-icon" v-html="iconSvg(it.id)"></span>
              <b>{{ it.name }}</b><em>{{ it.desc }}</em>
              <button class="buy-btn" :disabled="stash.coins < it.price" @click="doBuy('supplies', it.id)">{{ it.price }} 金币</button>
            </div>
          </div>
          <p v-if="msg" class="shop-msg">{{ msg }}</p>
        </div>
      </div>
      <!-- 出击配置弹窗 -->
      <div v-if="modal === 'loadout'" class="modal-mask" @click.self="modal = null">
        <div class="modal modal-wide">
          <h2>出击配置 <button class="modal-x" @click="modal = null">✕</button></h2>
          <div class="loadout-cols">
            <!-- 左：仓库 -->
            <div class="loadout-col">
              <p class="loadout-sec">仓库</p>
              <div class="loadout-drop" @dragover.prevent @drop="onDropFromStash($event)">
                <div v-for="(it, i) in stash.items" :key="'st' + i" class="loadout-card" :class="{ supply: it.kind === 'supply' || it.usable }" :draggable="it.kind === 'supply' || it.usable" @dragstart="onDragStash($event, i)">
                  <span class="svg-icon" v-html="iconSvg(it.id)"></span>
                  <b>{{ it.name }}</b>
                </div>
                <p v-if="!stash.items.length" class="bag-empty">仓库空空如也</p>
              </div>
            </div>
            <!-- 右：出击配置 -->
            <div class="loadout-col">
              <p class="loadout-sec">武器</p>
              <div class="loadout-grid">
                <div v-for="w in stash.weapons" :key="w" class="loadout-card" :class="{ on: stash.loadout.weapons.includes(w) }" @click="toggleLoadoutWeapon(w)">
                  <span class="svg-icon" v-html="iconSvg(w)"></span>
                  <b>{{ WEAPONS[w] ? WEAPONS[w].name : w }}</b>
                </div>
              </div>
              <p class="loadout-sec">护甲</p>
              <div class="loadout-grid">
                <div class="loadout-card" :class="{ on: !stash.loadout.armor }" @click="stash.loadout.armor = null; saveStash(stash)">
                  <span class="svg-icon" v-html="iconSvg('none')"></span>
                  <b>无护甲</b>
                </div>
                <div v-if="stash.armor" class="loadout-card" :class="{ on: stash.loadout.armor === stash.armor }" @click="stash.loadout.armor = stash.armor; saveStash(stash)">
                  <span class="svg-icon" v-html="iconSvg(stash.armor)"></span>
                  <b>{{ stash.armor === 'light' ? '轻量防火板' : '重型机柜装甲' }}</b>
                </div>
              </div>
              <p class="loadout-sec">携带道具</p>
              <div class="loadout-drop target" @dragover.prevent @drop="onDropToLoadout($event)">
                <div v-for="(it, i) in stash.loadout.items" :key="'lo' + i" class="loadout-card on" draggable="true" @dragstart="onDragLoadout($event, i)">
                  <span class="svg-icon" v-html="iconSvg(it.id)"></span>
                  <b>{{ it.name }}</b>
                </div>
                <p v-if="!stash.loadout.items.length" class="bag-empty">将道具拖到这里</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { DuckovGame, WEAPONS, PART_CATS } from '../game/duckov/game.js';
import { render } from '../game/duckov/renderer.js';
import { sound } from '../game/audio.js';
import { getAuthToken } from '../api.js';
import { loadStash, saveStash, bankStash, failStash, buy, sellItem, sellAllLoot, medkitCount, loadoutMedkitCount, moveItemToLoadout, moveItemBack, consumeMedkits, consumeSupplies, bagCapacity, armorMul, SHOP, ITEM_DEFS, safeboxCapacity, moveToSafebox, moveFromSafebox, synthPreview, synthesizePC, PC_MULT } from '../game/duckov/stash.js';

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

// 仓库展示的已拥有武器/护甲（免费运维手枪不显示）
const ownedGear = computed(() => {
  const list = [];
  for (const w of stash.value.weapons) {
    if (w === 'pistol') continue;
    list.push({ id: w, name: WEAPONS[w] ? WEAPONS[w].name : w, tag: '武器' });
  }
  if (stash.value.armor) {
    list.push({ id: stash.value.armor, name: stash.value.armor === 'light' ? '轻量防火板' : '重型机柜装甲', tag: '护甲' });
  }
  return list;
});

// —— 云端存档同步：跟随账号而非浏览器 ——
let syncTimer = null;
async function pullCloudStash() {
  if (!getAuthToken()) return; // 未登录保持本地存档
  try {
    const res = await fetch('/api/duckov/stash', { headers: { Authorization: 'Bearer ' + getAuthToken() } });
    if (!res.ok) return;
    const data = await res.json();
    if (data.stash) {
      stash.value = data.stash;
      saveStash(data.stash);
    }
  } catch (e) { /* 离线时忽略 */ }
}
function pushCloudStash() {
  if (!getAuthToken()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await fetch('/api/duckov/stash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getAuthToken() },
        body: JSON.stringify({ stash: stash.value })
      });
    } catch (e) { /* 离线时忽略 */ }
  }, 800);
}
watch(stash, pushCloudStash, { deep: true });

function toggleLoadoutWeapon(w) {
  if (w === 'pistol') return; // 默认武器必带
  const arr = stash.value.loadout.weapons;
  const i = arr.indexOf(w);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(w);
  saveStash(stash.value);
  stash.value = { ...stash.value };
}

function setLoadoutMedkits(n) {
  stash.value.loadout.medkits = Math.max(0, Math.min(medkitCount(stash.value), n));
  saveStash(stash.value);
  stash.value = { ...stash.value };
}

// —— 拖拽联动 ——
function onDragStash(ev, idx) {
  ev.dataTransfer.setData('text/plain', 'stash:' + idx);
  ev.dataTransfer.effectAllowed = 'move';
}

function onDragLoadout(ev, idx) {
  ev.dataTransfer.setData('text/plain', 'loadout:' + idx);
  ev.dataTransfer.effectAllowed = 'move';
}

function onDropToLoadout(ev) {
  const data = ev.dataTransfer.getData('text/plain');
  if (!data.startsWith('stash:')) return;
  const idx = parseInt(data.slice(6), 10);
  const r = moveItemToLoadout(stash.value, idx);
  msg.value = r.msg;
  if (r.ok) sound.play('pickup');
  stash.value = { ...stash.value };
}

function onDropFromStash(ev) {
  const data = ev.dataTransfer.getData('text/plain');
  if (!data.startsWith('loadout:')) return;
  const idx = parseInt(data.slice(8), 10);
  const r = moveItemBack(stash.value, idx);
  msg.value = r.msg;
  if (r.ok) sound.play('pickup');
  stash.value = { ...stash.value };
}
const bagItems = ref([]);
const minimapRef = ref(null);
const mapBig = ref(false);
const paused = ref(false);

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// 小地图：小图以玩家为中心；大图全图可拖动查看；玩家为呼吸灯特效
const mapDrag = ref({ x: 0, y: 0 });
let mmDown = false, mmMoved = false, mmLast = null;
function clampMapDrag() {
  const m = game && game.map;
  if (!m) return;
  const size = 420;
  const scale = size / Math.max(m.W, m.H);
  const mw = m.W * scale, mh = m.H * scale;
  mapDrag.value.x = Math.min(0, Math.max(size - mw, mapDrag.value.x));
  mapDrag.value.y = Math.min(0, Math.max(size - mh, mapDrag.value.y));
}
function onMmDown(ev) {
  if (!mapBig.value) return;
  mmDown = true; mmMoved = false; mmLast = { x: ev.clientX, y: ev.clientY };
}
function onMmMove(ev) {
  if (!mmDown || !mmLast) return;
  const dx = ev.clientX - mmLast.x, dy = ev.clientY - mmLast.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) mmMoved = true;
  mapDrag.value.x += dx;
  mapDrag.value.y += dy;
  mmLast = { x: ev.clientX, y: ev.clientY };
  clampMapDrag();
  drawMinimap();
}
function onMmUp() { mmDown = false; mmLast = null; }
function onMmClick() {
  if (mapBig.value && mmMoved) return;
  mapBig.value = !mapBig.value;
  if (!mapBig.value) mapDrag.value = { x: 0, y: 0 };
}
function drawMinimap() {
  const c = minimapRef.value;
  if (!c || !game || !game.map) return;
  const big = mapBig.value;
  const size = big ? 420 : 150;
  if (c.width !== size) { c.width = size; c.height = size; }
  const ctx = c.getContext('2d');
  const m = game.map;
  const p = game.player;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(5,10,18,0.88)';
  ctx.fillRect(0, 0, size, size);
  let scale, ox, oy;
  if (big) {
    scale = size / Math.max(m.W, m.H);
    ox = mapDrag.value.x; oy = mapDrag.value.y;
  } else {
    const view = 900;
    scale = size / view;
    ox = size / 2 - p.x * scale;
    oy = size / 2 - p.y * scale;
  }
  const tx = v => v * scale + ox;
  const ty = v => v * scale + oy;
  // 走廊通道（先画，垫在房间下方）
  for (const co of m.corridors) {
    ctx.fillStyle = 'rgba(103,232,249,0.18)';
    ctx.fillRect(tx(co.x), ty(co.y), co.w * scale, co.h * scale);
    ctx.strokeStyle = 'rgba(103,232,249,0.30)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx(co.x), ty(co.y), co.w * scale, co.h * scale);
  }
  // 房间
  for (const r of m.rooms) {
    ctx.fillStyle = 'rgba(34,211,238,0.10)';
    ctx.fillRect(tx(r.x), ty(r.y), r.w * scale, r.h * scale);
    ctx.strokeStyle = 'rgba(103,232,249,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx(r.x), ty(r.y), r.w * scale, r.h * scale);
  }
  // 撤离点（区分类型：钥匙门=橙/绿随钥匙状态，快速通道=青色）
  for (const e of m.exits) {
    const express = e.mode === 'express';
    const locked = e.needKey && !game.hasKey;
    const col = express ? '#22d3ee' : (locked ? '#f59e0b' : '#4ade80');
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(tx(e.x), ty(e.y), big ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (big) {
      ctx.fillStyle = col;
      ctx.font = '10px monospace';
      ctx.fillText(express ? 'FAST' : (locked ? 'EXIT🔒' : 'EXIT'), tx(e.x) + 8, ty(e.y) + 3);
    }
  }
  // 玩家：呼吸灯特效（脉冲光环）
  const t = performance.now() / 1000;
  const breath = 0.5 + 0.5 * Math.sin(t * 2.4);
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(tx(p.x), ty(p.y), big ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(34,211,238,' + (0.2 + 0.6 * breath).toFixed(2) + ')';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tx(p.x), ty(p.y), (big ? 8 : 6) + breath * (big ? 7 : 5), 0, Math.PI * 2);
  ctx.stroke();
}

// —— 手绘 SVG 物品图标（48x48 矢量绘制，禁用 emoji）——
// 配件专属图标：每一种配件型号独立绘制（CPU 核心布局 / 显卡风扇数 / 内存单双条 / SSD 马甲 / 电源模组线 / 机箱风道 / 散热器形态 / 整机档位）
const PART_ICONS = {
  // CPU：AMD 橙 / Intel 蓝，核心布局各不相同
  'cpu-a0': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#431407" stroke="#fb923c" stroke-width="2"/><rect x="15" y="15" width="18" height="18" rx="1" fill="#c2410c"/><rect x="17" y="17" width="4" height="4" fill="#fdba74"/><rect x="23" y="17" width="4" height="4" fill="#fdba74"/><rect x="17" y="23" width="4" height="4" fill="#fdba74"/><rect x="23" y="23" width="4" height="4" fill="#fdba74"/><rect x="17" y="29" width="10" height="2" fill="#fed7aa"/>',
  'cpu-i0': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#172554" stroke="#60a5fa" stroke-width="2"/><rect x="15" y="15" width="18" height="18" rx="1" fill="#1d4ed8"/><rect x="17" y="17" width="4" height="4" fill="#93c5fd"/><rect x="23" y="17" width="4" height="4" fill="#93c5fd"/><rect x="29" y="17" width="2" height="4" fill="#93c5fd"/><rect x="17" y="23" width="14" height="8" rx="1" fill="#bfdbfe"/>',
  'cpu-a1': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#431407" stroke="#fb923c" stroke-width="2"/><rect x="15" y="15" width="18" height="18" rx="1" fill="#ea580c"/><circle cx="24" cy="24" r="7" fill="#fdba74"/><circle cx="24" cy="24" r="3" fill="#fff7ed"/>',
  'cpu-i1': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#172554" stroke="#60a5fa" stroke-width="2"/><rect x="15" y="15" width="18" height="18" rx="1" fill="#1e40af"/><rect x="17" y="17" width="6" height="6" fill="#93c5fd"/><rect x="25" y="17" width="6" height="6" fill="#93c5fd"/><rect x="17" y="25" width="3" height="3" fill="#bfdbfe"/><rect x="22" y="25" width="3" height="3" fill="#bfdbfe"/><rect x="27" y="25" width="3" height="3" fill="#bfdbfe"/><rect x="17" y="30" width="13" height="2" fill="#bfdbfe"/>',
  'cpu-a2': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#431407" stroke="#f97316" stroke-width="2"/><rect x="15" y="15" width="18" height="13" rx="1" fill="#c2410c"/><rect x="17" y="17" width="3" height="3" fill="#fdba74"/><rect x="22" y="17" width="3" height="3" fill="#fdba74"/><rect x="27" y="17" width="3" height="3" fill="#fdba74"/><rect x="17" y="22" width="3" height="3" fill="#fdba74"/><rect x="22" y="22" width="3" height="3" fill="#fdba74"/><rect x="27" y="22" width="3" height="3" fill="#fdba74"/><rect x="15" y="30" width="18" height="3" rx="1" fill="#fde047"/>',
  'cpu-i2': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#172554" stroke="#60a5fa" stroke-width="2"/><rect x="15" y="15" width="18" height="18" rx="1" fill="#1e3a8a"/><rect x="17" y="17" width="5" height="5" fill="#93c5fd"/><rect x="24" y="17" width="5" height="5" fill="#93c5fd"/><rect x="17" y="24" width="5" height="5" fill="#93c5fd"/><rect x="24" y="24" width="5" height="5" fill="#93c5fd"/><circle cx="31.5" cy="18" r="1.2" fill="#bfdbfe"/><circle cx="31.5" cy="22" r="1.2" fill="#bfdbfe"/><circle cx="31.5" cy="26" r="1.2" fill="#bfdbfe"/><circle cx="31.5" cy="30" r="1.2" fill="#bfdbfe"/>',
  'cpu-a3': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#431407" stroke="#f97316" stroke-width="2.5"/><rect x="15" y="15" width="18" height="12" rx="1" fill="#ea580c"/><rect x="17" y="17" width="2.5" height="2.5" fill="#ffedd5"/><rect x="21" y="17" width="2.5" height="2.5" fill="#ffedd5"/><rect x="25" y="17" width="2.5" height="2.5" fill="#ffedd5"/><rect x="29" y="17" width="2.5" height="2.5" fill="#ffedd5"/><rect x="17" y="21" width="2.5" height="2.5" fill="#ffedd5"/><rect x="21" y="21" width="2.5" height="2.5" fill="#ffedd5"/><rect x="25" y="21" width="2.5" height="2.5" fill="#ffedd5"/><rect x="29" y="21" width="2.5" height="2.5" fill="#ffedd5"/><rect x="15" y="29" width="18" height="4" rx="1" fill="#fde047"/>',
  'cpu-i3': '<rect x="9" y="9" width="30" height="30" rx="3" fill="#172554" stroke="#93c5fd" stroke-width="2.5"/><rect x="15" y="15" width="18" height="18" rx="1" fill="#1d4ed8"/><rect x="17" y="17" width="2.5" height="2.5" fill="#dbeafe"/><rect x="21" y="17" width="2.5" height="2.5" fill="#dbeafe"/><rect x="25" y="17" width="2.5" height="2.5" fill="#dbeafe"/><rect x="29" y="17" width="2.5" height="2.5" fill="#dbeafe"/><rect x="17" y="21" width="2.5" height="2.5" fill="#dbeafe"/><rect x="21" y="21" width="2.5" height="2.5" fill="#dbeafe"/><rect x="25" y="21" width="2.5" height="2.5" fill="#dbeafe"/><rect x="29" y="21" width="2.5" height="2.5" fill="#dbeafe"/><rect x="17" y="25" width="2.5" height="2.5" fill="#dbeafe"/><rect x="21" y="25" width="2.5" height="2.5" fill="#dbeafe"/><rect x="25" y="25" width="2.5" height="2.5" fill="#dbeafe"/><rect x="29" y="25" width="2.5" height="2.5" fill="#dbeafe"/><rect x="17" y="29" width="14" height="2" fill="#bfdbfe"/>',
  // 主板：板型/供电散热/芯片组布局各不相同
  'mb-a0': '<rect x="8" y="12" width="32" height="26" rx="2" fill="#431407" stroke="#fb923c" stroke-width="2"/><rect x="12" y="16" width="10" height="10" rx="1" fill="#c2410c"/><rect x="26" y="16" width="10" height="4" rx="1" fill="#fdba74"/><rect x="26" y="23" width="10" height="3" rx="1" fill="#fdba74"/><rect x="12" y="30" width="24" height="4" rx="1" fill="#9a3412"/>',
  'mb-i0': '<rect x="8" y="12" width="32" height="26" rx="2" fill="#172554" stroke="#60a5fa" stroke-width="2"/><rect x="12" y="16" width="10" height="10" rx="1" fill="#1d4ed8"/><rect x="26" y="16" width="10" height="4" rx="1" fill="#93c5fd"/><rect x="26" y="23" width="10" height="3" rx="1" fill="#93c5fd"/><rect x="12" y="30" width="24" height="4" rx="1" fill="#1e40af"/>',
  'mb-a1': '<rect x="8" y="12" width="32" height="26" rx="2" fill="#431407" stroke="#fb923c" stroke-width="2"/><rect x="12" y="16" width="8" height="8" rx="1" fill="#c2410c"/><rect x="23" y="16" width="4" height="18" rx="1" fill="#ea580c"/><rect x="30" y="16" width="6" height="18" rx="1" fill="#9a3412"/><rect x="12" y="28" width="8" height="6" rx="1" fill="#fdba74"/>',
  'mb-i1': '<rect x="8" y="12" width="32" height="26" rx="2" fill="#172554" stroke="#60a5fa" stroke-width="2"/><rect x="12" y="16" width="8" height="8" rx="1" fill="#1d4ed8"/><rect x="23" y="16" width="4" height="18" rx="1" fill="#3b82f6"/><rect x="30" y="16" width="6" height="18" rx="1" fill="#1e40af"/><rect x="12" y="28" width="8" height="6" rx="1" fill="#93c5fd"/>',
  'mb-a2': '<rect x="6" y="10" width="36" height="28" rx="2" fill="#431407" stroke="#f97316" stroke-width="2"/><rect x="10" y="14" width="12" height="8" rx="1" fill="#c2410c"/><rect x="10" y="25" width="12" height="9" rx="1" fill="#ea580c"/><circle cx="31" cy="19" r="6" fill="#7c2d12" stroke="#fdba74" stroke-width="1.5"/><rect x="25" y="28" width="13" height="6" rx="1" fill="#fde047"/>',
  'mb-i2': '<rect x="6" y="10" width="36" height="28" rx="2" fill="#172554" stroke="#93c5fd" stroke-width="2"/><rect x="10" y="14" width="12" height="8" rx="1" fill="#1d4ed8"/><rect x="10" y="25" width="12" height="9" rx="1" fill="#3b82f6"/><circle cx="31" cy="19" r="6" fill="#1e3a8a" stroke="#bfdbfe" stroke-width="1.5"/><rect x="25" y="28" width="13" height="6" rx="1" fill="#e0f2fe"/>',
  'mb-a3': '<rect x="6" y="10" width="36" height="28" rx="2" fill="#292524" stroke="#fde047" stroke-width="2.5"/><rect x="10" y="14" width="28" height="9" rx="1" fill="#78350f"/><rect x="10" y="26" width="13" height="9" rx="1" fill="#b45309"/><circle cx="31" cy="30" r="5" fill="#fde047"/><rect x="27" y="14" width="11" height="8" rx="1" fill="#fbbf24"/>',
  'mb-i3': '<rect x="6" y="10" width="36" height="28" rx="2" fill="#0c4a6e" stroke="#e0f2fe" stroke-width="2.5"/><rect x="10" y="14" width="28" height="9" rx="1" fill="#075985"/><rect x="10" y="26" width="13" height="9" rx="1" fill="#0284c7"/><circle cx="31" cy="30" r="5" fill="#e0f2fe"/><rect x="27" y="14" width="11" height="8" rx="1" fill="#7dd3fc"/>',
  // 显卡：风扇数 / 配色 / 体型各不相同
  'gpu-r7600': '<rect x="4" y="14" width="40" height="18" rx="3" fill="#450a0a" stroke="#f87171" stroke-width="2"/><circle cx="18" cy="23" r="6" fill="#7f1d1d" stroke="#fca5a5" stroke-width="1.5"/><circle cx="18" cy="23" r="2" fill="#fecaca"/><rect x="8" y="32" width="30" height="3" fill="#fca5a5"/><rect x="38" y="17" width="4" height="10" fill="#fecaca"/>',
  'gpu-4060': '<rect x="6" y="16" width="36" height="15" rx="3" fill="#052e16" stroke="#4ade80" stroke-width="2"/><circle cx="19" cy="23" r="5" fill="#166534" stroke="#86efac" stroke-width="1.5"/><rect x="10" y="31" width="26" height="3" fill="#fde047"/><rect x="36" y="18" width="4" height="9" fill="#86efac"/>',
  'gpu-5060ti': '<rect x="4" y="14" width="40" height="18" rx="3" fill="#052e16" stroke="#4ade80" stroke-width="2"/><circle cx="15" cy="23" r="5.5" fill="#166534" stroke="#86efac" stroke-width="1.5"/><circle cx="30" cy="23" r="5.5" fill="#166534" stroke="#86efac" stroke-width="1.5"/><rect x="8" y="32" width="30" height="3" fill="#fde047"/><rect x="38" y="17" width="4" height="10" fill="#86efac"/>',
  'gpu-9070xt': '<rect x="3" y="14" width="42" height="19" rx="3" fill="#450a0a" stroke="#f87171" stroke-width="2.5"/><circle cx="13" cy="23" r="5" fill="#7f1d1d" stroke="#fca5a5" stroke-width="1.5"/><circle cx="24" cy="23" r="5" fill="#7f1d1d" stroke="#fca5a5" stroke-width="1.5"/><circle cx="35" cy="23" r="5" fill="#7f1d1d" stroke="#fca5a5" stroke-width="1.5"/><rect x="7" y="33" width="32" height="3" fill="#fca5a5"/>',
  'gpu-5070ti': '<rect x="4" y="13" width="40" height="19" rx="3" fill="#052e16" stroke="#22d3ee" stroke-width="2"/><circle cx="16" cy="22" r="6" fill="#166534" stroke="#86efac" stroke-width="1.5"/><circle cx="31" cy="22" r="6" fill="#166534" stroke="#86efac" stroke-width="1.5"/><rect x="8" y="32" width="30" height="3" fill="#22d3ee"/><rect x="38" y="16" width="4" height="10" fill="#86efac"/>',
  'gpu-5080': '<rect x="3" y="14" width="42" height="19" rx="3" fill="#052e16" stroke="#4ade80" stroke-width="2.5"/><circle cx="13" cy="23" r="5" fill="#166534" stroke="#86efac" stroke-width="1.5"/><circle cx="24" cy="23" r="5" fill="#166534" stroke="#86efac" stroke-width="1.5"/><circle cx="35" cy="23" r="5" fill="#166534" stroke="#86efac" stroke-width="1.5"/><rect x="7" y="33" width="32" height="3" fill="#fde047"/>',
  'gpu-5090': '<rect x="2" y="12" width="44" height="22" rx="3" fill="#422006" stroke="#fde047" stroke-width="2.5"/><circle cx="13" cy="23" r="6" fill="#78350f" stroke="#fbbf24" stroke-width="1.5"/><circle cx="24" cy="23" r="6" fill="#78350f" stroke="#fbbf24" stroke-width="1.5"/><circle cx="35" cy="23" r="6" fill="#78350f" stroke="#fbbf24" stroke-width="1.5"/><rect x="6" y="34" width="34" height="3" fill="#fde047"/><rect x="40" y="15" width="4" height="12" fill="#fbbf24"/>',
  // 内存：单双条 / 马甲 / RGB 各不相同
  'ram-0': '<rect x="14" y="8" width="20" height="32" rx="2" fill="#14532d" stroke="#22d3ee" stroke-width="2"/><rect x="18" y="12" width="5" height="4" fill="#22d3ee"/><rect x="25" y="12" width="5" height="4" fill="#22d3ee"/><rect x="18" y="19" width="5" height="4" fill="#22d3ee"/><rect x="25" y="19" width="5" height="4" fill="#22d3ee"/><rect x="16" y="34" width="16" height="4" fill="#fde047"/>',
  'ram-1': '<rect x="14" y="8" width="20" height="32" rx="2" fill="#14532d" stroke="#22d3ee" stroke-width="2"/><rect x="17" y="12" width="14" height="14" rx="1" fill="#166534"/><rect x="19" y="14" width="4" height="3" fill="#67e8f9"/><rect x="25" y="14" width="4" height="3" fill="#67e8f9"/><rect x="19" y="19" width="4" height="3" fill="#67e8f9"/><rect x="25" y="19" width="4" height="3" fill="#67e8f9"/><rect x="16" y="34" width="16" height="4" fill="#fde047"/>',
  'ram-2': '<rect x="8" y="8" width="14" height="32" rx="2" fill="#14532d" stroke="#22d3ee" stroke-width="2"/><rect x="11" y="12" width="8" height="4" fill="#67e8f9"/><rect x="11" y="19" width="8" height="4" fill="#67e8f9"/><rect x="26" y="8" width="14" height="32" rx="2" fill="#14532d" stroke="#22d3ee" stroke-width="2"/><rect x="29" y="12" width="8" height="4" fill="#67e8f9"/><rect x="29" y="19" width="8" height="4" fill="#67e8f9"/><rect x="10" y="34" width="10" height="4" fill="#fde047"/><rect x="28" y="34" width="10" height="4" fill="#fde047"/>',
  'ram-3': '<rect x="8" y="8" width="14" height="32" rx="2" fill="#1c1917" stroke="#fde047" stroke-width="2"/><rect x="10" y="10" width="10" height="4" fill="#fde047"/><rect x="11" y="17" width="8" height="4" fill="#67e8f9"/><rect x="11" y="24" width="8" height="4" fill="#67e8f9"/><rect x="26" y="8" width="14" height="32" rx="2" fill="#1c1917" stroke="#fde047" stroke-width="2"/><rect x="28" y="10" width="10" height="4" fill="#fde047"/><rect x="29" y="17" width="8" height="4" fill="#67e8f9"/><rect x="29" y="24" width="8" height="4" fill="#67e8f9"/><rect x="10" y="34" width="10" height="4" fill="#fde047"/><rect x="28" y="34" width="10" height="4" fill="#fde047"/>',
  // 固态硬盘：颗粒数 / 散热马甲各不相同
  'ssd-0': '<rect x="4" y="18" width="40" height="12" rx="2" fill="#334155" stroke="#94a3b8" stroke-width="2"/><rect x="10" y="21" width="7" height="6" fill="#cbd5e1"/><rect x="20" y="21" width="7" height="6" fill="#cbd5e1"/><circle cx="40" cy="24" r="2" fill="#64748b"/>',
  'ssd-1': '<rect x="4" y="18" width="40" height="12" rx="2" fill="#334155" stroke="#94a3b8" stroke-width="2"/><rect x="9" y="21" width="6" height="6" fill="#cbd5e1"/><rect x="17" y="21" width="6" height="6" fill="#cbd5e1"/><rect x="25" y="21" width="6" height="6" fill="#cbd5e1"/><circle cx="40" cy="24" r="2" fill="#64748b"/>',
  'ssd-2': '<rect x="4" y="18" width="40" height="12" rx="2" fill="#1e293b" stroke="#e2e8f0" stroke-width="2"/><rect x="8" y="20" width="3" height="8" fill="#94a3b8"/><rect x="13" y="20" width="3" height="8" fill="#94a3b8"/><rect x="18" y="20" width="3" height="8" fill="#94a3b8"/><rect x="23" y="20" width="3" height="8" fill="#94a3b8"/><rect x="28" y="20" width="3" height="8" fill="#94a3b8"/><circle cx="40" cy="24" r="2" fill="#64748b"/>',
  'ssd-3': '<rect x="4" y="18" width="40" height="12" rx="2" fill="#422006" stroke="#fde047" stroke-width="2"/><rect x="8" y="20" width="4" height="8" fill="#fbbf24"/><rect x="14" y="20" width="4" height="8" fill="#fbbf24"/><rect x="20" y="20" width="4" height="8" fill="#fbbf24"/><rect x="26" y="20" width="4" height="8" fill="#fbbf24"/><circle cx="40" cy="24" r="2" fill="#fde047"/>',
  // 电源：80PLUS 等级 / 模组线各不相同
  'psu-0': '<rect x="8" y="12" width="32" height="24" rx="3" fill="#475569" stroke="#94a3b8" stroke-width="2"/><circle cx="20" cy="24" r="7" fill="#64748b" stroke="#cbd5e1" stroke-width="1.5"/><rect x="30" y="17" width="7" height="3" rx="1" fill="#cbd5e1"/><rect x="30" y="23" width="7" height="3" rx="1" fill="#cbd5e1"/><rect x="30" y="29" width="7" height="3" rx="1" fill="#cbd5e1"/>',
  'psu-1': '<rect x="8" y="12" width="32" height="24" rx="3" fill="#1c1917" stroke="#fbbf24" stroke-width="2"/><circle cx="20" cy="24" r="7" fill="#292524" stroke="#fbbf24" stroke-width="1.5"/><circle cx="34" cy="18" r="3" fill="#fde047"/><rect x="30" y="24" width="7" height="3" rx="1" fill="#fdba74"/><rect x="30" y="30" width="7" height="3" rx="1" fill="#fdba74"/>',
  'psu-2': '<rect x="8" y="12" width="32" height="24" rx="3" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/><circle cx="19" cy="24" r="7" fill="#1e293b" stroke="#7dd3fc" stroke-width="1.5"/><path d="M28 18 Q36 14 40 20" fill="none" stroke="#38bdf8" stroke-width="2"/><path d="M28 24 Q38 22 42 28" fill="none" stroke="#38bdf8" stroke-width="2"/><path d="M28 30 Q36 30 40 36" fill="none" stroke="#38bdf8" stroke-width="2"/>',
  'psu-3': '<rect x="8" y="12" width="32" height="24" rx="3" fill="#292524" stroke="#fde047" stroke-width="2.5"/><circle cx="19" cy="24" r="8" fill="#422006" stroke="#fbbf24" stroke-width="1.5"/><circle cx="35" cy="17" r="3" fill="#fde047"/><path d="M29 20 Q37 16 41 22" fill="none" stroke="#fbbf24" stroke-width="2"/><path d="M29 27 Q38 26 42 32" fill="none" stroke="#fbbf24" stroke-width="2"/>',
  // 机箱：风道 / 侧透 / 配色各不相同
  'case-0': '<rect x="12" y="6" width="24" height="36" rx="2" fill="#44403c" stroke="#a8a29e" stroke-width="2"/><rect x="16" y="10" width="16" height="10" rx="1" fill="#78716c"/><rect x="17" y="24" width="2" height="14" fill="#d6d3d1"/><rect x="21" y="24" width="2" height="14" fill="#d6d3d1"/><rect x="25" y="24" width="2" height="14" fill="#d6d3d1"/><rect x="29" y="24" width="2" height="14" fill="#d6d3d1"/>',
  'case-1': '<rect x="12" y="6" width="24" height="36" rx="2" fill="#1c1917" stroke="#a78bfa" stroke-width="2"/><circle cx="17" cy="12" r="1.2" fill="#a78bfa"/><circle cx="22" cy="12" r="1.2" fill="#a78bfa"/><circle cx="27" cy="12" r="1.2" fill="#a78bfa"/><circle cx="32" cy="12" r="1.2" fill="#a78bfa"/><circle cx="17" cy="17" r="1.2" fill="#a78bfa"/><circle cx="22" cy="17" r="1.2" fill="#a78bfa"/><circle cx="27" cy="17" r="1.2" fill="#a78bfa"/><circle cx="32" cy="17" r="1.2" fill="#a78bfa"/><rect x="16" y="24" width="16" height="14" rx="1" fill="#312e81"/>',
  'case-2': '<rect x="12" y="6" width="24" height="36" rx="2" fill="#1e1b4b" stroke="#22d3ee" stroke-width="2"/><rect x="16" y="10" width="16" height="28" rx="1" fill="#0e7490" opacity="0.6"/><rect x="18" y="13" width="12" height="8" rx="1" fill="#67e8f9"/><rect x="18" y="24" width="12" height="5" rx="1" fill="#22d3ee"/>',
  'case-3': '<rect x="12" y="6" width="24" height="36" rx="2" fill="#292524" stroke="#fde047" stroke-width="2.5"/><rect x="16" y="10" width="16" height="28" rx="1" fill="#0c4a6e" opacity="0.7"/><rect x="18" y="13" width="12" height="8" rx="1" fill="#fde047"/><rect x="18" y="24" width="12" height="5" rx="1" fill="#fbbf24"/><rect x="14" y="4" width="20" height="3" rx="1" fill="#fde047"/>',
  // 散热器：单塔 / 双塔 / 双塔双扇 / 一体水冷
  'cool-0': '<rect x="10" y="10" width="28" height="28" rx="3" fill="#1e293b" stroke="#67e8f9" stroke-width="2"/><circle cx="24" cy="24" r="9" fill="#334155" stroke="#67e8f9" stroke-width="1.5"/><circle cx="24" cy="24" r="3" fill="#e0f2fe"/>',
  'cool-1': '<rect x="12" y="6" width="24" height="36" rx="2" fill="#334155" stroke="#67e8f9" stroke-width="2"/><rect x="16" y="10" width="16" height="12" rx="1" fill="#475569"/><circle cx="24" cy="30" r="7" fill="#1e293b" stroke="#67e8f9" stroke-width="1.5"/><circle cx="24" cy="30" r="2.5" fill="#e0f2fe"/>',
  'cool-2': '<rect x="8" y="8" width="14" height="32" rx="2" fill="#a8a29e" stroke="#78716c" stroke-width="2"/><rect x="26" y="8" width="14" height="32" rx="2" fill="#a8a29e" stroke="#78716c" stroke-width="2"/><circle cx="24" cy="24" r="8" fill="#d6d3d1" stroke="#78350f" stroke-width="2"/><circle cx="24" cy="24" r="2.5" fill="#78350f"/>',
  'cool-3': '<rect x="6" y="8" width="36" height="8" rx="2" fill="#0f172a" stroke="#fde047" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#fbbf24"/><circle cx="20" cy="12" r="3" fill="#fbbf24"/><circle cx="28" cy="12" r="3" fill="#fbbf24"/><circle cx="36" cy="12" r="3" fill="#fbbf24"/><path d="M12 16 Q10 26 18 30" fill="none" stroke="#38bdf8" stroke-width="2.5"/><path d="M34 16 Q38 26 30 30" fill="none" stroke="#38bdf8" stroke-width="2.5"/><circle cx="24" cy="34" r="7" fill="#1e293b" stroke="#fde047" stroke-width="2"/><circle cx="24" cy="34" r="2.5" fill="#fde047"/>',
  // 整机：按档位区分
  pc0: '<rect x="14" y="8" width="20" height="32" rx="2" fill="#334155" stroke="#4ade80" stroke-width="2"/><rect x="17" y="12" width="14" height="8" rx="1" fill="#166534"/><rect x="17" y="23" width="14" height="4" rx="1" fill="#4ade80"/><circle cx="24" cy="34" r="2" fill="#4ade80"/>',
  pc1: '<rect x="14" y="8" width="20" height="32" rx="2" fill="#052e16" stroke="#4ade80" stroke-width="2"/><rect x="17" y="12" width="14" height="8" rx="1" fill="#166534"/><rect x="17" y="23" width="14" height="4" rx="1" fill="#86efac"/><rect x="17" y="29" width="14" height="3" rx="1" fill="#fde047"/><circle cx="24" cy="35" r="2" fill="#4ade80"/>',
  pc2: '<rect x="14" y="8" width="20" height="32" rx="2" fill="#083344" stroke="#22d3ee" stroke-width="2.5"/><rect x="17" y="12" width="14" height="8" rx="1" fill="#155e75"/><rect x="17" y="22" width="14" height="4" rx="1" fill="#22d3ee"/><rect x="17" y="28" width="14" height="4" rx="1" fill="#67e8f9"/><circle cx="24" cy="36" r="2" fill="#22d3ee"/>',
  pc3: '<rect x="14" y="8" width="20" height="32" rx="2" fill="#422006" stroke="#fde047" stroke-width="2.5"/><rect x="17" y="12" width="14" height="8" rx="1" fill="#78350f"/><rect x="17" y="22" width="14" height="4" rx="1" fill="#fbbf24"/><rect x="17" y="28" width="14" height="4" rx="1" fill="#fde047"/><circle cx="24" cy="36" r="2" fill="#fde047"/>'
};

function iconSvg(id) {
  const S = {
    pistol: '<rect x="6" y="18" width="26" height="7" rx="1.5" fill="#67e8f9"/><rect x="10" y="25" width="8" height="12" rx="2" fill="#22d3ee"/><rect x="30" y="20" width="12" height="4" rx="1" fill="#a5f3fc"/><circle cx="9" cy="21.5" r="1.6" fill="#0e7490"/>',
    smg: '<rect x="4" y="18" width="30" height="6" rx="1.5" fill="#fbbf24"/><rect x="12" y="24" width="6" height="14" rx="1.5" fill="#f59e0b"/><rect x="22" y="24" width="5" height="9" rx="1.5" fill="#d97706"/><rect x="34" y="19.5" width="10" height="3" rx="1" fill="#fde68a"/><rect x="8" y="15" width="10" height="3" rx="1" fill="#b45309"/>',
    shotgun: '<rect x="4" y="20" width="40" height="5" rx="1.5" fill="#f472b6"/><rect x="14" y="25" width="14" height="5" rx="2" fill="#be185d"/><rect x="6" y="25" width="8" height="10" rx="2" fill="#9d174d"/><rect x="38" y="25" width="6" height="4" rx="1" fill="#fbcfe8"/>',
    railgun: '<rect x="4" y="21" width="40" height="6" rx="2" fill="#c084fc"/><rect x="10" y="16" width="4" height="16" rx="1" fill="#a855f7"/><rect x="18" y="16" width="4" height="16" rx="1" fill="#a855f7"/><rect x="26" y="16" width="4" height="16" rx="1" fill="#a855f7"/><rect x="34" y="23" width="10" height="2.5" rx="1" fill="#f5f3ff"/><rect x="6" y="27" width="7" height="9" rx="2" fill="#7e22ce"/>',
    laser: '<rect x="4" y="20" width="34" height="6" rx="2" fill="#a3e635"/><rect x="10" y="15" width="6" height="4" rx="1" fill="#65a30d"/><rect x="38" y="21" width="8" height="4" rx="1" fill="#ecfccb"/><rect x="12" y="26" width="6" height="12" rx="2" fill="#4d7c0f"/><circle cx="24" cy="23" r="2.4" fill="#f0fdf4"/>',
    rocket: '<rect x="6" y="19" width="30" height="10" rx="3" fill="#fb923c"/><path d="M36 19 L44 24 L36 29 Z" fill="#fdba74"/><circle cx="12" cy="24" r="5" fill="#c2410c"/><rect x="16" y="29" width="4" height="8" rx="1" fill="#9a3412"/><rect x="24" y="29" width="4" height="8" rx="1" fill="#9a3412"/><rect x="8" y="14" width="10" height="4" rx="1" fill="#7c2d12"/>',
    stim: '<rect x="20" y="6" width="8" height="24" rx="2" fill="#a3e635"/><rect x="22" y="30" width="4" height="10" rx="1" fill="#65a30d"/><rect x="16" y="10" width="16" height="3" rx="1" fill="#ecfccb"/><circle cx="24" cy="42" r="2" fill="#f0fdf4"/>',
    emp: '<circle cx="24" cy="26" r="12" fill="#0f172a" stroke="#22d3ee" stroke-width="2.5"/><circle cx="24" cy="26" r="5" fill="#22d3ee"/><path d="M24 6 L28 12 L20 12 Z" fill="#67e8f9"/><path d="M24 46 L28 40 L20 40 Z" fill="#67e8f9"/><path d="M4 26 L10 22 L10 30 Z" fill="#67e8f9"/><path d="M44 26 L38 22 L38 30 Z" fill="#67e8f9"/>',
    light: '<path d="M24 6 L38 12 V26 C38 34 31 40 24 42 C17 40 10 34 10 26 V12 Z" fill="#334155" stroke="#94a3b8" stroke-width="2"/><path d="M24 14 L30 17 V26 C30 31 27 34 24 36 C21 34 18 31 18 26 V17 Z" fill="#cbd5e1"/>',
    heavy: '<path d="M24 4 L40 11 V27 C40 37 32 42 24 44 C16 42 8 37 8 27 V11 Z" fill="#1e293b" stroke="#e2e8f0" stroke-width="2.5"/><rect x="18" y="16" width="12" height="16" rx="2" fill="#e2e8f0"/><rect x="21" y="20" width="6" height="8" rx="1" fill="#0f172a"/>',
    bag: '<rect x="10" y="14" width="28" height="28" rx="5" fill="#422006" stroke="#fbbf24" stroke-width="2"/><rect x="18" y="7" width="12" height="9" rx="4" fill="none" stroke="#fbbf24" stroke-width="2"/><rect x="19" y="24" width="10" height="10" rx="2" fill="#fbbf24"/>',
    ram: '<rect x="8" y="12" width="32" height="20" rx="2" fill="#14532d" stroke="#22c55e" stroke-width="2"/><rect x="13" y="17" width="7" height="5" fill="#22c55e"/><rect x="23" y="17" width="7" height="5" fill="#22c55e"/><rect x="13" y="25" width="7" height="3" fill="#86efac"/><rect x="23" y="25" width="7" height="3" fill="#86efac"/><rect x="10" y="32" width="28" height="4" fill="#fde047"/>',
    disk: '<circle cx="24" cy="24" r="17" fill="#94a3b8" stroke="#e2e8f0" stroke-width="2"/><circle cx="24" cy="24" r="10" fill="#cbd5e1"/><circle cx="24" cy="24" r="4" fill="#0f172a"/><rect x="23" y="6" width="2" height="9" fill="#64748b"/>',
    gpu: '<rect x="4" y="12" width="40" height="22" rx="3" fill="#052e16" stroke="#22c55e" stroke-width="2"/><circle cx="16" cy="23" r="7" fill="#166534" stroke="#4ade80" stroke-width="2"/><circle cx="32" cy="23" r="7" fill="#166534" stroke="#4ade80" stroke-width="2"/><rect x="8" y="34" width="32" height="4" fill="#fde047"/><rect x="38" y="16" width="4" height="14" fill="#86efac"/>',
    core: '<path d="M24 4 L40 18 L34 42 L14 42 L8 18 Z" fill="#fde047" stroke="#facc15" stroke-width="2"/><path d="M24 12 L33 21 L29 36 L19 36 L15 21 Z" fill="#fef9c3"/><circle cx="24" cy="24" r="4" fill="#fffbeb"/>',
    mb: '<rect x="6" y="10" width="36" height="28" rx="3" fill="#14532d" stroke="#22c55e" stroke-width="2"/><rect x="12" y="16" width="14" height="14" rx="1" fill="#166534"/><rect x="30" y="16" width="8" height="4" rx="1" fill="#86efac"/><rect x="30" y="23" width="8" height="4" rx="1" fill="#86efac"/><rect x="30" y="30" width="8" height="4" rx="1" fill="#86efac"/>',
    case: '<rect x="10" y="6" width="28" height="36" rx="3" fill="#1e1b4b" stroke="#a78bfa" stroke-width="2"/><rect x="15" y="11" width="18" height="10" rx="1" fill="#312e81"/><rect x="15" y="25" width="18" height="12" rx="1" fill="#4338ca"/>',
    pc: '<rect x="6" y="10" width="36" height="24" rx="3" fill="#052e16" stroke="#4ade80" stroke-width="2"/><rect x="12" y="16" width="24" height="12" rx="1" fill="#166534"/><rect x="14" y="36" width="20" height="4" rx="1" fill="#86efac"/>',
    fan: '<circle cx="24" cy="24" r="17" fill="#1e293b" stroke="#94a3b8" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="#cbd5e1"/><path d="M24 20 Q14 14 17 8 Q26 10 26 19 Z" fill="#94a3b8"/><path d="M28 24 Q34 14 40 17 Q38 26 29 26 Z" fill="#94a3b8"/><path d="M24 28 Q34 34 31 40 Q22 38 22 29 Z" fill="#94a3b8"/><path d="M20 24 Q14 34 8 31 Q10 22 19 22 Z" fill="#94a3b8"/>',
    chip: '<rect x="12" y="12" width="24" height="24" rx="2" fill="#831843" stroke="#f472b6" stroke-width="2"/><rect x="18" y="18" width="12" height="12" fill="#f472b6"/><rect x="15" y="6" width="3" height="6" fill="#f9a8d4"/><rect x="22" y="6" width="3" height="6" fill="#f9a8d4"/><rect x="29" y="6" width="3" height="6" fill="#f9a8d4"/><rect x="15" y="36" width="3" height="6" fill="#f9a8d4"/><rect x="22" y="36" width="3" height="6" fill="#f9a8d4"/><rect x="29" y="36" width="3" height="6" fill="#f9a8d4"/>',
    battery: '<rect x="14" y="10" width="20" height="32" rx="3" fill="#1a2e05" stroke="#a3e635" stroke-width="2"/><rect x="20" y="6" width="8" height="4" rx="1" fill="#a3e635"/><path d="M26 18 L20 27 L24 27 L22 36 L29 25 L25 25 Z" fill="#a3e635"/>',
    psu: '<rect x="8" y="12" width="32" height="26" rx="3" fill="#431407" stroke="#fb923c" stroke-width="2"/><circle cx="17" cy="25" r="7" fill="#7c2d12" stroke="#fb923c" stroke-width="1.5"/><rect x="28" y="18" width="8" height="3" rx="1" fill="#fdba74"/><rect x="28" y="24" width="8" height="3" rx="1" fill="#fdba74"/><rect x="28" y="30" width="8" height="3" rx="1" fill="#fdba74"/>',
    encrypted: '<rect x="10" y="20" width="28" height="20" rx="3" fill="#0c2d5a" stroke="#60a5fa" stroke-width="2"/><path d="M16 20 V14 a8 8 0 0 1 16 0 V20" fill="none" stroke="#60a5fa" stroke-width="2.5"/><circle cx="24" cy="30" r="3" fill="#93c5fd"/><rect x="23" y="30" width="2" height="5" fill="#93c5fd"/>',
    medkit: '<rect x="6" y="12" width="36" height="28" rx="4" fill="#1c0a0a" stroke="#f87171" stroke-width="2"/><rect x="20" y="8" width="8" height="6" rx="2" fill="#f87171"/><rect x="21.5" y="18" width="5" height="16" fill="#f87171"/><rect x="16" y="23.5" width="16" height="5" fill="#f87171"/>',
    none: '<path d="M24 6 L38 12 V26 C38 34 31 40 24 42 C17 40 10 34 10 26 V12 Z" fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="4 3"/>'
  };
  const sid = String(id || '');
  const wrap = (body) => '<svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  // 配件型号专属图标优先
  if (PART_ICONS[sid]) return wrap(PART_ICONS[sid]);
  // 整机 id（pc-{tier}-{platform}）按档位解析
  if (sid.startsWith('pc-')) {
    const t = Number(sid.split('-')[1]);
    const k = 'pc' + (t >= 0 && t <= 3 ? t : 0);
    if (PART_ICONS[k]) return wrap(PART_ICONS[k]);
  }
  const PREFIX = { cpu: 'chip', mb: 'mb', gpu: 'gpu', ram: 'ram', ssd: 'disk', psu: 'psu', case: 'case', cool: 'fan', pc: 'pc' };
  const key = S[id] ? id : (PREFIX[sid.split('-')[0]] || 'ram');
  return wrap(S[key]);
}

function doBuy(kind, id) {
  const r = buy(stash.value, kind, id);
  msg.value = r.msg;
  if (r.ok) sound.play('levelup');
  stash.value = { ...stash.value };
}

function doSafeboxIn(i) {
  const r = moveToSafebox(stash.value, i);
  msg.value = r.msg;
  if (r.ok) sound.play('pickup');
  stash.value = { ...stash.value };
}

function doSafeboxOut(i) {
  const r = moveFromSafebox(stash.value, i);
  msg.value = r.msg;
  if (r.ok) sound.play('pickup');
  stash.value = { ...stash.value };
}

function stashSafebox(i) {
  if (!game || !game.player) return;
  game.stashToSafebox(i);
  bagItems.value = [...game.player.bag];
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

const synthRows = computed(() => synthPreview(stash.value));

function doSynth() {
  const r = synthesizePC(stash.value);
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
  const lo = stash.value.loadout;
  const takeMedkits = lo.items.filter(it => it.id === 'medkit').length;
  const takeStims = lo.items.filter(it => it.id === 'stim').length;
  const takeEmps = lo.items.filter(it => it.id === 'emp').length;
  consumeMedkits(stash.value, takeMedkits);
  consumeSupplies(stash.value, 'stim', takeStims);
  consumeSupplies(stash.value, 'emp', takeEmps);
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
      // 未使用的出击消耗品返回仓库
      for (let i = 0; i < (game.stims || 0); i++) stash.value.items.push({ id: 'stim', ...ITEM_DEFS.stim, kind: 'supply' });
      for (let i = 0; i < (game.emps || 0); i++) stash.value.items.push({ id: 'emp', ...ITEM_DEFS.emp, kind: 'supply' });
      stash.value = { ...stash.value };
    },
    onHud: (h) => { hud.value = h; drawMinimap(); }
  });
  game.renderer = render;
  game.start({
    bagSize: bagCapacity(stash.value),
    armorMul: lo.armor ? (lo.armor === 'light' ? 0.75 : 0.55) : 1,
    armorName: lo.armor ? (lo.armor === 'light' ? '轻量防火板' : '重型机柜装甲') : '',
    armorId: lo.armor || '',
    safebox: stash.value.safebox,
    safeboxCap: safeboxCapacity(stash.value),
    weapons: lo.weapons.length ? lo.weapons : ['pistol'],
    medkits: takeMedkits,
    stims: takeStims,
    emps: takeEmps
  });
}

onMounted(() => {
  pullCloudStash();
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
  if (k === 'escape') {
    if (modal.value) { modal.value = null; return; }
    if (panel.value === 'playing' && game) { game.togglePause(); paused.value = game.paused; }
    return;
  }
  if (!game || game.state !== 'playing') return;
  game.keys[k] = true;
  if (k === 'shift' && game.player.stamina > 25 && game.player.dashCd <= 0) {
    game.player.dashT = 0.22;
    game.player.dashCd = 0.9;
    game.player.stamina -= 25;
  }
  if (k === 'h') game.useMedkit();
  if (k === 'g') game.useStim();
  if (k === 'q') game.useEmp();
  if (k === '1') game.player.weapon = 'pistol';
  if (k === '2' && game.ownedWeapons.includes('smg')) game.player.weapon = 'smg';
  if (k === '3' && game.ownedWeapons.includes('shotgun')) game.player.weapon = 'shotgun';
  if (k === '4' && game.ownedWeapons.includes('railgun')) game.player.weapon = 'railgun';
  if (k === '5' && game.ownedWeapons.includes('laser')) game.player.weapon = 'laser';
  if (k === '6' && game.ownedWeapons.includes('rocket')) game.player.weapon = 'rocket';
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
.hp-label { color: #f87171; font-weight: bold; }
.loot-val { color: #fde047; font-weight: bold; }
.hp-bar { width: 150px; height: 8px; background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; border: 1px solid rgba(248,113,113,0.35); }
.hp-fill { height: 100%; background: linear-gradient(90deg, #ef4444, #f87171); transition: width 0.15s; }
.hp-fill.low { animation: blink 0.5s infinite; }
.stamina-bar { width: 120px; height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; }
.stamina-fill { height: 100%; background: #22d3ee; transition: width 0.1s; }
.tip { margin-left: auto; color: #cbd5e1; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
/* 左下角玩家状态栏 */
.status-panel { position: absolute; left: 12px; bottom: 34px; display: flex; flex-direction: column; gap: 5px; padding: 10px 14px; background: rgba(5,7,13,0.82); border: 1px solid rgba(103,232,249,0.25); border-radius: 8px; font-size: 13px; z-index: 4; }
.sp-row { display: flex; align-items: center; gap: 8px; }
.sp-weapon-name { color: #67e8f9; font-weight: bold; font-size: 14px; }
.sp-ammo { color: #fbbf24; font-weight: bold; font-size: 14px; }
.sp-reloading { color: #fbbf24; font-weight: 600; animation: blink 0.6s infinite; }
.sp-reload-hint { color: #64748b; font-size: 11px; }
.sp-armor { color: #93c5fd; font-weight: 600; margin-left: 6px; }
.sp-label { color: #94a3b8; font-size: 11px; width: 26px; }
.sp-num { color: #e2e8f0; font-size: 11px; min-width: 52px; }
.sp-items { gap: 12px; font-size: 12px; }
.sp-loot { color: #fde047; font-weight: 600; }
.sp-med { color: #f87171; }
/* 撤离倒计时（顶部居中醒目） */
.exit-countdown { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); font-family: monospace; font-size: 22px; font-weight: bold; color: #e2e8f0; text-shadow: 0 0 12px rgba(34,211,238,0.6); pointer-events: none; }
.exit-countdown.danger { color: #f87171; animation: blink 0.6s infinite; }
/* 小地图（右上角，点击展开大图） */
.minimap { position: absolute; top: 10px; right: 12px; width: 150px; height: 150px; border: 1px solid #1e3a5f; border-radius: 8px; cursor: pointer; pointer-events: auto; z-index: 5; transition: width 0.2s, height 0.2s; }
.minimap.big { width: 420px; height: 420px; cursor: grab; }
.minimap.big:active { cursor: grabbing; }
/* 暂停遮罩 */
.pause-mask { position: absolute; inset: 0; background: rgba(2,4,10,0.72); display: flex; flex-direction: column; align-items: center; justify-content: center; color: #e2e8f0; font-family: monospace; z-index: 8; }
.pause-mask h2 { font-size: 34px; color: #67e8f9; margin: 0 0 8px; text-shadow: 0 0 20px rgba(34,211,238,0.5); }
.pause-mask p { color: #94a3b8; }
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
.loadout-cols { display: flex; gap: 14px; }
.loadout-col { flex: 1; min-width: 0; }
.svg-icon { width: 34px; height: 34px; display: block; flex-shrink: 0; }
.loadout-card .svg-icon { width: 44px; height: 44px; display: block; filter: drop-shadow(0 0 6px rgba(34,211,238,0.25)); }
.loadout-drop { min-height: 90px; border: 1.5px dashed #1e3a5f; border-radius: 8px; padding: 8px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; align-content: start; }
.loadout-drop.target { border-color: #22d3ee; background: rgba(34,211,238,0.04); }
.loadout-card.supply { cursor: grab; }
.loadout-card.supply:active { cursor: grabbing; }
.loadout-row { display: flex; align-items: center; gap: 14px; border: 1px solid #1e3a5f; border-radius: 8px; padding: 12px 16px; background: rgba(15,23,42,0.6); margin-bottom: 14px; }
.loadout-info { flex: 1; text-align: left; }
.loadout-info b { color: #f87171; display: block; font-size: 14px; }
.loadout-info em { color: #64748b; font-style: normal; font-size: 11px; }
.loadout-ctrl { display: flex; align-items: center; gap: 10px; }
.loadout-num { color: #fde047; font-size: 18px; min-width: 24px; text-align: center; }
/* 局内背包 */
.bag-panel .svg-icon { width: 26px; height: 26px; }
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
/* 防具 HUD 标签 */
.hud-top .armor { color: #93c5fd; font-weight: 600; }
/* 换弹提示 */
.hud-top .reloading { color: #fbbf24; font-weight: 600; animation: blink 0.6s infinite; }
/* 状态栏内图标 */
.sp-icon { display: inline-block; width: 22px; height: 22px; flex: none; }
.sp-item { display: inline-flex; align-items: center; gap: 3px; color: #f87171; }
.sp-key { font-style: normal; font-size: 10px; color: #94a3b8; border: 1px solid #475569; border-radius: 3px; padding: 0 3px; }
/* 状态栏内换弹进度条 */
.sp-reload-bar { width: 100%; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
.sp-reload-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); transition: width 0.05s linear; }
/* 仓库武器/护甲展示区 */
.stash-gear { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.stash-gear .stash-card { flex-direction: row; align-items: center; gap: 6px; padding: 6px 10px; }
.stash-gear .stash-card em { color: #67e8f9; font-style: normal; font-size: 11px; }
/* 安全箱 */
.safebox-sec { margin-bottom: 10px; }
.safebox-sec .loadout-sec { margin: 0 0 6px; }
.sb-note { font-style: normal; font-size: 11px; color: #64748b; margin-left: 8px; }
.safebox-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.safebox-cell { border-color: rgba(251,191,36,0.45); }
.bi-drop.sb-in { color: #fbbf24; border-color: rgba(251,191,36,0.5); }
/* 局内背包格子化 */
.bag-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
.bag-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 6px; background: rgba(15,23,42,0.9); border: 1px solid rgba(103,232,249,0.25); border-radius: 6px; }
.bag-cell .svg-icon { width: 34px; height: 34px; }
</style>
