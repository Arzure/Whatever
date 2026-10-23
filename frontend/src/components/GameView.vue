<template>
  <div class="game-view">
    <div ref="canvasWrap" class="canvas-wrap">
      <div class="hit-flash"></div>
    </div>
    <!-- HUD -->
    <div class="hud">
      <div class="hud-score">分数 <b :class="{ bump: scoreBump }">{{ score }}</b></div>
      <div class="hud-right">
        <div class="hud-lives">
          <span v-for="i in 3" :key="i" class="life" :class="{ lost: i > lives }">◆</span>
        </div>
        <button v-if="playing" class="hud-btn" title="暂停（Esc / P）" @click="pause">‖</button>
      </div>
    </div>
    <!-- 暂停覆盖层 -->
    <div v-if="paused" class="overlay">
      <div class="panel">
        <h2>已暂停</h2>
        <p class="final-score">当前得分 <b>{{ score }}</b></p>
        <div class="pause-actions">
          <button class="play-btn" @click="resume">继续</button>
          <button class="ghost-btn" @click="restart">重新开始</button>
        </div>
      </div>
    </div>
    <!-- 开始 / 结束覆盖层 -->
    <div v-if="!playing" class="overlay">
      <div class="panel">
        <h2>{{ over ? '游戏结束' : '挥剑挑战' }}</h2>
        <p v-if="over" class="final-score">本局得分 <b>{{ score }}</b> · 最高 {{ best }}</p>
        <p class="tip" v-if="!over">快速滑动鼠标挥剑，砍碎飞来的方块<br />漏 3 个方块即结束</p>
        <button class="play-btn" @click="start">{{ over ? '再来一局' : '开始游戏' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, inject, watch } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { api } from '../api';

const canvasWrap = ref(null);
const score = ref(0);
const best = ref(Number(localStorage.getItem('slash-best') || 0));
const lives = ref(3);
const playing = ref(false);
const over = ref(false);
const paused = ref(false);
const { state } = inject('game');
// 分数实时跳动反馈：每次加分数字弹跳放大
const scoreBump = ref(false);
watch(score, () => {
  scoreBump.value = false;
  requestAnimationFrame(() => { scoreBump.value = true; });
  setTimeout(() => { scoreBump.value = false; }, 320);
});

let renderer, scene, camera, rafId;
let obstacles = [];
let sword, swordTipWorld = new THREE.Vector3();
let swordBox = new THREE.Box3();
let obBox = new THREE.Box3();
let mouse = { x: 0, y: 0, ax: 0, ay: 0, speed: 0, lastT: 0 };
// 剑的活动范围：按相机视锥实时计算（z=0 平面的可见半宽/半高），保证剑精确贴合光标
let halfW = 5.5, halfH = 3.2;
const CAM_Y = 1.2; // 相机高度：z=0 平面的视场中心在 y=1.2 而非 0，剑跟随必须补偿此偏移
let spawnTimer = 0;
let flashDiv = null;
// 拖尾：记录刀尖最近 N 个世界坐标
const TRAIL_LEN = 22;
let trailPts = [];
let trailLine = null;

const isLight = () => document.documentElement.classList.contains('light');

function loadAssets(onDone) {
  const loader = new GLTFLoader();
  const swordParts = [];
  let pending = 4; // 3 剑部件 + 收尾
  const done = () => { if (--pending === 0) onDone(swordParts); };
  // 剑三段拼装（blade / guard / hilt 模型来自开源项目 SlashSaber，CC BY 4.0，仅代码注释记录来源）
  for (const part of ['blade_default', 'guard_default', 'hilt_default']) {
    loader.load(`/3d/sword/${part}.glb`, (gltf) => {
      swordParts.push(gltf.scene);
      done();
    }, undefined, () => done()); // 加载失败也放行，降级用几何剑
  }
  done(); // 计数对齐
  return swordParts;
}

function buildSword(swordParts) {
  const g = new THREE.Group();
  if (swordParts && swordParts.length === 3) {
    // GLB 模型剑：按参考项目定位（模型自身 up 为 Z 轴），整体前伸
    const model = new THREE.Group();
    for (const part of swordParts) model.add(part);
    model.position.set(0, 0, -0.6); // 参考项目为相机相对定位(0,0.65,-0.8)，此处适配鼠标跟随：居中于光标、刀刃朝前
    model.up.set(0, 0, 1);
    g.add(model);
    g.userData.isGLB = true;
  } else {
    // 降级：几何剑（素材加载失败时兜底）
    const steel = new THREE.MeshStandardMaterial({ color: 0xcfd6e4, metalness: 0.95, roughness: 0.18 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a12c, metalness: 0.8, roughness: 0.28 });
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.055, 2.5, 4), steel);
    blade.rotation.x = Math.PI / 2;
    blade.position.z = -1.45;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.09), gold);
    guard.position.z = -0.18;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.55, 8), gold);
    hilt.rotation.x = Math.PI / 2;
    hilt.position.z = 0.18;
    g.add(blade, guard, hilt);
  }
  g.scale.setScalar(1.8); // 剑整体放大：原尺寸在场景中偏小
  scene.add(g);
  return g;
}

function buildTrail() {
  // 面状拖尾（三角带 ribbon）：与剑刃判定面同宽同位置，挥过的区域就是判定区域
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 2 * 3), 3));
  geo.setIndex([]);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xbfe8ff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  trailLine = new THREE.Mesh(geo, mat);
  trailLine.frustumCulled = false;
  scene.add(trailLine);
}

function updateTrail() {
  // 记录剑刃面板上下边缘（与判定面同宽 y±0.9，取刃中部深度）：挥过的光面就是判定区域
  const midZ = sword.position.z - 2.0;
  trailPts.unshift([
    new THREE.Vector3(sword.position.x, sword.position.y + 0.9, midZ),
    new THREE.Vector3(sword.position.x, sword.position.y - 0.9, midZ),
  ]);
  if (trailPts.length > TRAIL_LEN) trailPts.pop();
  const pos = trailLine.geometry.getAttribute('position');
  const n = trailPts.length;
  for (let i = 0; i < TRAIL_LEN; i++) {
    const pair = trailPts[Math.min(i, n - 1)];
    pos.setXYZ(i * 2, pair[0].x, pair[0].y, pair[0].z);
    pos.setXYZ(i * 2 + 1, pair[1].x, pair[1].y, pair[1].z);
  }
  pos.needsUpdate = true;
  // 三角带索引：相邻两帧的上下边缘拼成两个三角形
  const idx = [];
  for (let i = 0; i < TRAIL_LEN - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  trailLine.geometry.setIndex(idx);
  const op = Math.min(0.55, mouse.speed / 6); // 挥得越快光面越亮
  trailLine.material.opacity = op;
}

function buildScene(swordParts) {
  const light = isLight();
  scene = new THREE.Scene();
  // 环境贴图（参考项目同款素材）：金属剑有反射不再发黑，全场材质受益
  new THREE.TextureLoader().load('/3d/sword/blade_envmap.jpeg', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if (scene) scene.environment = tex;
  });
  scene.background = new THREE.Color(light ? 0xdfe6f5 : 0x0b1122);
  scene.fog = new THREE.Fog(scene.background, 18, 55);

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1.2, 6);

  scene.add(new THREE.AmbientLight(0xffffff, light ? 0.95 : 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.3);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  const grid = new THREE.GridHelper(80, 40, light ? 0x9aa8cc : 0x2a3a66, light ? 0xc4cde8 : 0x1a2547);
  grid.position.y = -2.2;
  scene.add(grid);

  buildTrail();
}

function spawnObstacle() {
  // 障碍物：发光方块（全色相随机，颜色丰富）
  const hue = Math.random();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.75, 0.55),
      emissive: new THREE.Color().setHSL(hue, 0.9, 0.18),
    })
  );
  mesh.position.set((Math.random() - 0.5) * 10.4, (Math.random() - 0.5) * 4.4, -48); // 生成范围扩大到完整可视区域
  mesh.userData = {
    speed: 7.5 + Math.random() * 4 + Math.min(score.value * 0.1, 6),
    spin: new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    cut: false,
  };
  scene.add(mesh);
  obstacles.push(mesh);
}

function slashEffect(pos, color) {
  // 碎屑：障碍物同色碎片 + 白色高光屑飞散
  for (let i = 0; i < 14; i++) {
    const isSpark = i < 4;
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.06, 0.06),
      isSpark
        ? new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
        : new THREE.MeshStandardMaterial({ color, emissive: color })
    );
    frag.position.copy(pos);
    frag.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    frag.userData = {
      vel: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, Math.random() * 8),
      life: 0.7,
    };
    scene.add(frag);
    obstacles.push(frag);
  }
}
// 命中闪光圈：白色圆环快速扩散淡出
function flashRing(pos) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.36, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.position.copy(pos);
  ring.position.z += 0.6;
  ring.userData = { life: 0.35, ring: true };
  scene.add(ring);
  obstacles.push(ring);
}
// 命中飘字：+1 从命中点上浮淡出
function popScore(worldPos) {
  if (!canvasWrap.value) return;
  const v = worldPos.clone().project(camera);
  const el = document.createElement('span');
  el.className = 'score-pop';
  el.textContent = '+1';
  const r = canvasWrap.value.getBoundingClientRect();
  el.style.left = `${(v.x * 0.5 + 0.5) * r.width}px`;
  el.style.top = `${(-v.y * 0.5 + 0.5) * r.height}px`;
  canvasWrap.value.appendChild(el);
  setTimeout(() => el.remove(), 800);
}


// —— 砍击判定：碰撞盒相交 + 挥砍速度阈值（方向判定已按需求移除）——
function trySlash() {
  if (mouse.speed < 1.0) return; // 阈值大幅降低：正常速度挥动即可砍中
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ob = obstacles[i];
    if (!ob.userData || ob.userData.cut || ob.userData.life !== undefined) continue;
    obBox.setFromObject(ob);
    if (!swordBox.intersectsBox(obBox)) continue;
    ob.userData.cut = true;
    slashEffect(ob.position.clone(), ob.material.color.getHex());
    flashRing(ob.position.clone());
    popScore(ob.position.clone());
    scene.remove(ob);
    obstacles.splice(i, 1); // 关键：同步从数组移除，否则已砍掉的方块仍会飞过判定线误扣血
    score.value++;
  }
}

function tick(dt) {
  if (!sword) return; // 剑未就绪（GLB 加载中）：跳过本帧，障碍物仅在开始后才生成
  const tx = mouse.x * halfW;
  const ty = mouse.y * halfH + CAM_Y; // 补偿相机高度：剑精确贴合光标
  sword.position.x += (tx - sword.position.x) * 0.5;
  sword.position.y += (ty - sword.position.y) * 0.5;
  // —— 挥舞动画：三轴联动——横向甩动倾斜 z、纵向挥动俯仰 x、挥动越快剑身前刺 ——
  const tiltZ = Math.max(-1.15, Math.min(1.15, mouse.ax * 2.4));
  const tiltX = Math.max(-0.55, Math.min(0.55, mouse.ay * 1.4));
  sword.rotation.z += (tiltZ - sword.rotation.z) * 0.32;
  sword.rotation.x += (tiltX - sword.rotation.x) * 0.32;
  // 剑组基准 z=-0.35：剑柄正好落在光标平面，光标十字吸附剑柄
  const lunge = Math.min(0.7, mouse.speed * 0.07);
  sword.position.z += (-0.35 - lunge - sword.position.z) * 0.22;
  swordTipWorld.set(sword.position.x, sword.position.y, sword.position.z - 2.2);
  // 判定盒贴合剑刃形状：薄厚（x）× 高（y）× 长刃（z）的宽面板，观感与判定一致
  swordBox.min.set(sword.position.x - 0.3, sword.position.y - 0.9, sword.position.z - 3.2);
  swordBox.max.set(sword.position.x + 0.3, sword.position.y + 0.9, sword.position.z - 0.8);
  updateTrail();

  // 挥砍速度与方向累计量随时间衰减
  const decay = Math.max(0, 1 - 6 * dt);
  mouse.speed *= decay;
  mouse.ax *= decay;
  mouse.ay *= decay;

  if (playing.value && !paused.value) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = Math.max(0.45, 1.15 - score.value * 0.008);
    }
    trySlash();
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ob = obstacles[i];
    if (ob.userData.life !== undefined) {
      ob.userData.life -= dt;
      if (ob.userData.ring) {
        // 命中闪光圈：扩散 + 淡出
        const p = Math.max(0, ob.userData.life / 0.35);
        ob.scale.setScalar(1 + (1 - p) * 8);
        ob.material.opacity = p * 0.9;
      } else {
        ob.userData.vel.y -= 12 * dt;
        ob.position.addScaledVector(ob.userData.vel, dt);
      }
      if (ob.userData.life <= 0) { scene.remove(ob); obstacles.splice(i, 1); }
      continue;
    }
    if (paused.value) continue; // 暂停：障碍物冻结
    ob.position.z += ob.userData.speed * dt;
    ob.rotation.x += ob.userData.spin.x * dt;
    ob.rotation.y += ob.userData.spin.y * dt;
    if (ob.position.z > 1.5) {
      // 漏接判定在玩家平面（剑所在 z≈0 略后）：方块冲到面前才扣血，视觉与判定一致
      scene.remove(ob);
      obstacles.splice(i, 1);
      if (playing.value) {
        lives.value--;
        flashHit();
        if (lives.value <= 0) endGame();
      }
    }
  }
}

function flashHit() {
  if (!flashDiv) return;
  flashDiv.classList.remove('hit');
  void flashDiv.offsetWidth;
  flashDiv.classList.add('hit');
}

function start() {
  score.value = 0;
  lives.value = 3;
  over.value = false;
  playing.value = true;
  for (const ob of obstacles) scene.remove(ob);
  obstacles = [];
  spawnTimer = 0.6;
}

// —— 暂停 / 继续 / 重开 / 退出 ——
function pause() {
  if (playing.value && !over.value) paused.value = true;
}
function resume() {
  paused.value = false;
}
function restart() {
  paused.value = false;
  start();
}
function onKeydown(e) {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (paused.value) resume();
    else pause();
  }
}

function endGame() {
  playing.value = false;
  over.value = true;
  if (score.value > best.value) {
    best.value = score.value;
    localStorage.setItem('slash-best', String(best.value));
  }
}

function onPointerMove(e) {
  const r = canvasWrap.value.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
  const now = performance.now();
  const dx = nx - mouse.x;
  const dy = ny - mouse.y;
  if (mouse.lastT) {
    const dt = Math.max((now - mouse.lastT) / 1000, 0.004);
    const v = Math.hypot(dx, dy) / dt;
    mouse.speed = Math.max(mouse.speed * 0.5, v);
  }
  mouse.ax += dx;
  mouse.ay += dy;
  mouse.x = nx;
  mouse.y = ny;
  mouse.lastT = now;
}

function onResize() {
  if (!renderer) return;
  const w = canvasWrap.value.clientWidth;
  const h = canvasWrap.value.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 视锥可见范围（z=0 平面）：随窗口尺寸/宽高比变化，剑的活动范围与之同步
  halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
  halfW = halfH * camera.aspect;
}

let lastT = 0;
function loop(t) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  tick(dt);
  renderer.render(scene, camera);
}

onMounted(() => {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasWrap.value.appendChild(renderer.domElement);
  flashDiv = canvasWrap.value.querySelector('.hit-flash');
  buildScene(); // 不预建几何剑：避免先抽象剑后突变真剑的闪变
  // 3D 资源已纳入登录票据保护：先领取票据（HttpOnly cookie，Path=/3d/），再加载剑模型
  // 票据失败（未登录/过期）时仍尝试加载——服务端会拒绝，走几何剑降级，游戏可玩
  api.ticket3d().catch(() => {}).finally(() => {
    // GLB 剑素材加载完成才创建剑（开始面板正好遮住加载期）；加载失败降级几何剑
    loadAssets((parts) => {
      if (scene) sword = buildSword(parts && parts.length === 3 ? parts : []);
    });
  });
  onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('keydown', onKeydown);
  rafId = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('keydown', onKeydown);
  renderer?.dispose();
});
</script>

<style scoped>
.game-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}
.canvas-wrap {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}
.hit-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
}
.hit-flash.hit {
  animation: hitflash 0.4s ease-out;
}
@keyframes hitflash {
  0% { box-shadow: inset 0 0 120px rgba(220, 60, 60, 0.55); opacity: 1; }
  100% { opacity: 0; }
}
.hud {
  position: absolute;
  top: 14px;
  left: 18px;
  right: 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  pointer-events: none;
  font-weight: 600;
}
.hud-score { color: var(--text); font-size: 15px; }
.hud-score b { color: var(--accent); font-size: 20px; margin-left: 4px; display: inline-block; }
.hud-score b.bump { animation: score-bump 0.32s ease-out; }
@keyframes score-bump {
  0% { transform: scale(1); }
  40% { transform: scale(1.45); }
  100% { transform: scale(1); }
}
.hud-right { display: flex; align-items: center; gap: 12px; }
.hud-lives { display: flex; gap: 6px; }
.hud-btn {
  pointer-events: auto;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s;
}
.hud-btn:hover { border-color: var(--accent); }
.pause-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}
.ghost-btn {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 34px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text);
  background: transparent;
  transition: border-color 0.2s;
}
.ghost-btn:hover { border-color: var(--accent); }
.life { color: #e05252; font-size: 18px; transition: opacity 0.3s; }
.life.lost { opacity: 0.18; }
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 30, 0.45);
  backdrop-filter: blur(4px);
  z-index: 5;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 34px 46px;
  text-align: center;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}
.panel h2 { margin: 0 0 12px; color: var(--text); font-size: 24px; }
.final-score { color: var(--text); margin: 6px 0; }
.final-score b { color: var(--accent); font-size: 22px; }
.tip { color: var(--muted, #8a94b8); font-size: 13px; line-height: 1.8; margin: 6px 0 18px; }
.play-btn {
  border: none;
  border-radius: 10px;
  padding: 11px 34px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  color: #1a1303;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
}
html.light .play-btn { color: #fff; }
.play-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
.score-pop {
  position: absolute;
  transform: translate(-50%, -50%);
  color: var(--accent);
  font-size: 20px;
  font-weight: 800;
  text-shadow: 0 0 10px rgba(212, 161, 44, 0.6);
  pointer-events: none;
  z-index: 3;
  animation: score-pop 0.8s ease-out forwards;
}
@keyframes score-pop {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  25% { opacity: 1; transform: translate(-50%, -60%) scale(1.15); }
  100% { opacity: 0; transform: translate(-50%, -160%) scale(1); }
}
</style>
