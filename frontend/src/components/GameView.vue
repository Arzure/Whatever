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
        <p class="tip" v-if="!over">快速滑动鼠标挥剑，斩断飞来的竹子<br />漏 3 根竹子即结束</p>
        <button class="play-btn" @click="start">{{ over ? '再来一局' : '开始游戏' }}</button>
        <p class="credit">3D 素材来自开源项目 SlashSaber（CC BY 4.0）</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const canvasWrap = ref(null);
const score = ref(0);
const best = ref(Number(localStorage.getItem('slash-best') || 0));
const lives = ref(3);
const playing = ref(false);
const over = ref(false);

let renderer, scene, camera, rafId;
let obstacles = [];
let sword, swordTipWorld = new THREE.Vector3();
let swordBox = new THREE.Box3();
let obBox = new THREE.Box3();
let mouse = { x: 0, y: 0, ax: 0, ay: 0, speed: 0, lastT: 0 };
let spawnTimer = 0;
let flashDiv = null;
// 模型模板：竹子障碍物（加载后 clone 生成实例）
let bambooTemplates = [];
let assetsReady = false;
// 拖尾：记录刀尖最近 N 个世界坐标
const TRAIL_LEN = 22;
let trailPts = [];
let trailLine = null;

const isLight = () => document.documentElement.classList.contains('light');

function loadAssets(onDone) {
  const loader = new GLTFLoader();
  const swordParts = [];
  let pending = 8; // 3 剑部件 + 4 竹子 + 收尾
  const done = () => { if (--pending === 0) { assetsReady = true; onDone(); } };
  // 剑三段拼装（参考 SlashSaber：blade / guard / hilt）
  for (const part of ['blade_default', 'guard_default', 'hilt_default']) {
    loader.load(`/3d/sword/${part}.glb`, (gltf) => {
      swordParts.push(gltf.scene);
      done();
    }, undefined, () => done()); // 加载失败也放行，降级用几何剑
  }
  // 竹子障碍物模板
  for (const name of ['bamboo_mid_1', 'bamboo_mid_3', 'bamboo_mid_5', 'bamboo_mid_7']) {
    loader.load(`/3d/obstacles/${name}.glb`, (gltf) => {
      bambooTemplates.push(gltf.scene);
      done();
    }, undefined, () => done());
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
    model.position.set(0, 0.65, -0.8);
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
  scene.add(g);
  return g;
}

function buildTrail() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x9dd0e3, transparent: true, opacity: 0.55 });
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
  trailLine.material.opacity = Math.min(0.75, mouse.speed / 8);
}

function buildScene(swordParts) {
  const light = isLight();
  scene = new THREE.Scene();
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

  sword = buildSword(swordParts);
  buildTrail();
}

function spawnObstacle() {
  let mesh;
  if (assetsReady && bambooTemplates.length) {
    // 竹子模型：随机模板 clone
    const tpl = bambooTemplates[Math.floor(Math.random() * bambooTemplates.length)];
    mesh = tpl.clone(true);
    mesh.scale.setScalar(1.6);
  } else {
    // 降级：几何方块
    const hue = 0.08 + Math.random() * 0.12;
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.1, 1.1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.75, 0.55),
        emissive: new THREE.Color().setHSL(hue, 0.9, 0.18),
      })
    );
  }
  mesh.position.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 3.4, -48);
  mesh.userData = {
    speed: 9 + Math.random() * 5 + Math.min(score.value * 0.12, 8),
    spin: new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    cut: false,
  };
  scene.add(mesh);
  obstacles.push(mesh);
}

function slashEffect(pos) {
  // 竹屑：绿色小片飞散
  for (let i = 0; i < 10; i++) {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x7fae5a, emissive: 0x2c4419 })
    );
    frag.position.copy(pos);
    frag.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    frag.userData = {
      vel: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, Math.random() * 7),
      life: 0.7,
    };
    scene.add(frag);
    obstacles.push(frag);
  }
}

// —— 砍击判定：碰撞盒相交 + 挥砍速度阈值（方向判定已按需求移除）——
function trySlash() {
  if (mouse.speed < 2.2) return;
  for (const ob of obstacles) {
    if (!ob.userData || ob.userData.cut || ob.userData.life !== undefined) continue;
    obBox.setFromObject(ob);
    if (!swordBox.intersectsBox(obBox)) continue;
    ob.userData.cut = true;
    slashEffect(ob.position.clone());
    scene.remove(ob);
    score.value++;
  }
}

function tick(dt) {
  const tx = mouse.x * 5.5;
  const ty = mouse.y * 3.2;
  sword.position.x += (tx - sword.position.x) * 0.4;
  sword.position.y += (ty - sword.position.y) * 0.4;
  const targetTilt = Math.max(-0.9, Math.min(0.9, mouse.ax * 1.5));
  sword.rotation.z += (targetTilt - sword.rotation.z) * 0.25;
  swordTipWorld.set(sword.position.x, sword.position.y, -1.2);
  swordBox.min.set(sword.position.x - 0.35, sword.position.y - 0.35, -2.7);
  swordBox.max.set(sword.position.x + 0.35, sword.position.y + 0.35, 0.1);
  updateTrail();

  // 挥砍速度与方向累计量随时间衰减
  const decay = Math.max(0, 1 - 6 * dt);
  mouse.speed *= decay;
  mouse.ax *= decay;
  mouse.ay *= decay;

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
  const swordParts = loadAssets(() => {}); // 素材异步加载，竹子就绪后自动启用
  buildScene(swordParts);
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
.credit { margin: 16px 0 0; font-size: 11px; color: var(--muted, #8a94b8); opacity: 0.7; }
</style>
