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
        <p class="tip" v-if="!over">快速滑动鼠标挥剑切割飞来的方块<br />带箭头的方块必须按箭头方向砍 · 漏 3 个即结束</p>
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
let sword, swordTip;
let mouse = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0 };
let spawnTimer = 0;
let flashDiv = null;

const isLight = () => document.documentElement.classList.contains('light');

function buildScene() {
  const light = isLight();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(light ? 0xdfe6f5 : 0x0b1122);
  scene.fog = new THREE.Fog(scene.background, 18, 55);

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1.2, 6);

  // 灯光
  scene.add(new THREE.AmbientLight(0xffffff, light ? 0.9 : 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  // 地面网格
  const grid = new THREE.GridHelper(80, 40, light ? 0x9aa8cc : 0x2a3a66, light ? 0xc4cde8 : 0x1a2547);
  grid.position.y = -2.2;
  scene.add(grid);

  // 剑：细长盒子，跟随鼠标
  const swordGroup = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xd4a12c, metalness: 0.7, roughness: 0.25, emissive: 0x3d2c05 })
  );
  blade.position.z = -1.3;
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.14, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x8a6a1e, metalness: 0.6, roughness: 0.3 })
  );
  swordGroup.add(blade, guard);
  scene.add(swordGroup);
  sword = swordGroup;
  swordTip = new THREE.Vector3();
}

function spawnObstacle() {
  const needDir = Math.random() < 0.35; // 35% 需要指定方向
  const dirH = Math.random() < 0.5; // true=水平砍 false=垂直砍
  const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  const hue = 0.08 + Math.random() * 0.12; // 金橙系
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.75, 0.55),
    emissive: new THREE.Color().setHSL(hue, 0.9, 0.18),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 3.4, -48);
  mesh.userData = {
    speed: 9 + Math.random() * 5 + Math.min(score.value * 0.12, 8),
    spin: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
    needDir, dirH, cut: false,
  };
  if (needDir) {
    // 方向指示：细长发光条贴在方块表面
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
  // 简易爆裂：8 个小方块飞散后移除
  for (let i = 0; i < 8; i++) {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color, emissive: color })
    );
    frag.position.copy(pos);
    frag.userData = {
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, Math.random() * 6),
      life: 0.7,
    };
    scene.add(frag);
    obstacles.push(frag); // 复用数组，life 到期移除
  }
}

function trySlash() {
  if (mouse.speed < 18) return; // 挥砍速度阈值
  const horizontal = Math.abs(mouse.vx) > Math.abs(mouse.vy);
  for (const ob of obstacles) {
    if (!ob.userData || ob.userData.cut || ob.userData.life !== undefined) continue;
    if (ob.userData.needDir && ob.userData.dirH !== horizontal) continue; // 方向不符砍不动
    const d = ob.position.distanceTo(swordTip);
    if (d < 1.6) {
      ob.userData.cut = true;
      slashEffect(ob.position.clone(), ob.material.color.getHex());
      scene.remove(ob);
      score.value++;
    }
  }
}

function tick(dt) {
  // 剑跟随鼠标（映射到 z=0 平面）
  const tx = mouse.x * 5.5;
  const ty = mouse.y * 3.2;
  sword.position.x += (tx - sword.position.x) * 0.35;
  sword.position.y += (ty - sword.position.y) * 0.35;
  swordTip.set(sword.position.x, sword.position.y, -1.2);

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
      // 碎片
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
      // 漏接
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
