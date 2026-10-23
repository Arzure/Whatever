<template>
  <div class="game-view">
    <div ref="canvasWrap" class="canvas-wrap">
      <div class="hit-flash"></div>
    </div>
    <!-- HUD -->
    <div class="hud">
      <div class="hud-score">分数 <b>{{ score }}</b></div>
      <div class="hud-lives">
        <span v-for="i in 3" :key="i" class="life" :class="{ lost: i > lives }">◆</span>
      </div>
    </div>
    <!-- 开始 / 结束覆盖层 -->
    <div v-if="!playing" class="overlay">
      <div class="panel">
        <h2>{{ over ? '游戏结束' : '挥剑挑战' }}</h2>
        <p v-if="over" class="final-score">本局得分 <b>{{ score }}</b> · 最高 {{ best }}</p>
        <p class="tip" v-if="!over">快速滑动鼠标挥剑切割飞来的方块<br />带紫色指示条的方块必须按指示方向砍 · 漏 3 个即结束</p>
        <button class="play-btn" @click="start">{{ over ? '再来一局' : '开始游戏' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';

const canvasWrap = ref(null);
const score = ref(0);
const best = ref(Number(localStorage.getItem('slash-best') || 0));
const lives = ref(3);
const playing = ref(false);
const over = ref(false);

let renderer, scene, camera, rafId;
let obstacles = [];
let sword, swordTipWorld = new THREE.Vector3();
let swordBox = new THREE.Box3();      // 剑的碰撞盒（每帧随剑更新）
let obBox = new THREE.Box3();
let mouse = { x: 0, y: 0, vx: 0, vy: 0, speed: 0 };
let spawnTimer = 0;
let flashDiv = null;
// 拖尾：记录刀尖最近 N 个世界坐标，用发光线条渲染
const TRAIL_LEN = 22;
let trailPts = [];
let trailLine = null;

const isLight = () => document.documentElement.classList.contains('light');

function buildSword() {
  // —— 三段式剑（参考 SlashSaber：blade / guard / hilt 拼装）——
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd6e4, metalness: 0.95, roughness: 0.18 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a12c, metalness: 0.8, roughness: 0.28 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2c14, metalness: 0.2, roughness: 0.7 });

  // 刀刃：细长四面锥体（CylinderGeometry 4 边，顶半径小底半径大），有剑的锋锐感
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.055, 2.5, 4), steel);
  blade.rotation.x = Math.PI / 2;   // 圆柱默认沿 Y，转到指向 -Z（前方）
  blade.position.z = -1.45;
  // 刀刃中脊高光条
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ridge.position.z = -1.4;
  // 护手：十字横梁
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.09), gold);
  guard.position.z = -0.18;
  // 握柄：细圆柱
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.55, 8), grip);
  hilt.rotation.x = Math.PI / 2;
  hilt.position.z = 0.18;
  // 柄尾：小圆头
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), gold);
  pommel.position.z = 0.48;

  g.add(blade, ridge, guard, hilt, pommel);
  scene.add(g);
  return g;
}

function buildTrail() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xd4a12c, transparent: true, opacity: 0.55 });
  trailLine = new THREE.Line(geo, mat);
  trailLine.frustumCulled = false;
  scene.add(trailLine);
}

function updateTrail() {
  trailPts.unshift(swordTipWorld.clone());
  if (trailPts.length > TRAIL_LEN) trailPts.pop();
  const attr = trailLine.geometry.getAttribute('position');
  for (let i = 0; i < TRAIL_LEN; i++) {
    const p = trailPts[Math.min(i, trailPts.length - 1)] || swordTipWorld;
    attr.setXYZ(i, p.x, p.y, p.z);
  }
  attr.needsUpdate = true;
  // 挥砍速度越大拖尾越亮
  trailLine.material.opacity = Math.min(0.75, mouse.speed / 40);
}

function buildScene() {
  const light = isLight();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(light ? 0xdfe6f5 : 0x0b1122);
  scene.fog = new THREE.Fog(scene.background, 18, 55);

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1.2, 6);

  scene.add(new THREE.AmbientLight(0xffffff, light ? 0.9 : 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  const grid = new THREE.GridHelper(80, 40, light ? 0x9aa8cc : 0x2a3a66, light ? 0xc4cde8 : 0x1a2547);
  grid.position.y = -2.2;
  scene.add(grid);

  sword = buildSword();
  buildTrail();
}

function spawnObstacle() {
  const needDir = Math.random() < 0.35;
  const dirH = Math.random() < 0.5;
  const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  const hue = 0.08 + Math.random() * 0.12;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.75, 0.55),
    emissive: new THREE.Color().setHSL(hue, 0.9, 0.18),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 3.4, -48);
  mesh.userData = {
    speed: 9 + Math.random() * 5 + Math.min(score.value * 0.12, 8),
    spin: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
    needDir, dirH, cut: false, colliding: false,
  };
  if (needDir) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(dirH ? 1.5 : 0.16, dirH ? 0.16 : 1.5, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x6d5ae0 })
    );
    bar.position.z = 0.58;
    mesh.add(bar);
  }
  scene.add(mesh);
  obstacles.push(mesh);
}

function slashEffect(pos, color) {
  for (let i = 0; i < 10; i++) {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshStandardMaterial({ color, emissive: color })
    );
    frag.position.copy(pos);
    frag.userData = {
      vel: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, Math.random() * 7),
      life: 0.7,
    };
    scene.add(frag);
    obstacles.push(frag);
  }
}

// —— 砍击判定（参考 SlashSaber：碰撞盒相交 + 挥砍速度阈值 + 方向判定）——
function trySlash() {
  if (mouse.speed < 14) return; // 挥砍速度阈值：慢移不判砍
  const horizontal = Math.abs(mouse.vx) > Math.abs(mouse.vy);
  for (const ob of obstacles) {
    if (!ob.userData || ob.userData.cut || ob.userData.life !== undefined) continue;
    // 障碍物世界包围盒
    obBox.setFromObject(ob);
    if (!swordBox.intersectsBox(obBox)) continue; // 剑碰撞盒与障碍物相交才可砍
    if (ob.userData.needDir && ob.userData.dirH !== horizontal) continue; // 方向不符砍不动
    ob.userData.cut = true;
    slashEffect(ob.position.clone(), ob.material.color.getHex());
    scene.remove(ob);
    score.value++;
  }
}

function tick(dt) {
  // 剑跟随鼠标（映射到 z=0 平面），并按移动方向倾斜——像真的挥剑
  const tx = mouse.x * 5.5;
  const ty = mouse.y * 3.2;
  sword.position.x += (tx - sword.position.x) * 0.4;
  sword.position.y += (ty - sword.position.y) * 0.4;
  // 挥动时剑身朝速度方向倾斜
  const targetTilt = Math.max(-0.9, Math.min(0.9, mouse.vx * 2.2));
  sword.rotation.z += (targetTilt - sword.rotation.z) * 0.25;
  // 刀尖世界坐标 + 剑碰撞盒（沿剑身的长条盒）
  swordTipWorld.set(sword.position.x, sword.position.y, -1.2);
  swordBox.min.set(sword.position.x - 0.35, sword.position.y - 0.35, -2.7);
  swordBox.max.set(sword.position.x + 0.35, sword.position.y + 0.35, 0.1);
  updateTrail();

  if (playing.value) {
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
      ob.userData.vel.y -= 12 * dt;
      ob.position.addScaledVector(ob.userData.vel, dt);
      if (ob.userData.life <= 0) { scene.remove(ob); obstacles.splice(i, 1); }
      continue;
    }
    ob.position.z += ob.userData.speed * dt;
    ob.rotation.x += ob.userData.spin.x * dt;
    ob.rotation.y += ob.userData.spin.y * dt;
    if (ob.position.z > 6.5) {
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
  mouse.vx = nx - mouse.x;
  mouse.vy = ny - mouse.y;
  mouse.x = nx;
  mouse.y = ny;
  mouse.speed = Math.hypot(mouse.vx, mouse.vy) * 60;
}

function onResize() {
  if (!renderer) return;
  const w = canvasWrap.value.clientWidth;
  const h = canvasWrap.value.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
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
  buildScene();
  onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  rafId = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('pointermove', onPointerMove);
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
.hud-score b { color: var(--accent); font-size: 20px; margin-left: 4px; }
.hud-lives { display: flex; gap: 6px; }
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
</style>
