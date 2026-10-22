<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

/* WebGL2 流体绸缎背景（移植自 ReactBits Silk 开源实现，MIT）
   双 pass：FIELD 渲染 1/4 分辨率泛光场，COMPOSITE 全屏合成
   核心：silk 褶皱图案 + 指针拖拽形变 + 点击波纹 + 法线光照/高光 + mipmap 泛光 */
const props = defineProps({
  speed: { type: Number, default: 5 },
  darkColor: { type: String, default: '#8a9bff' },
  lightColor: { type: String, default: '#6d5ae0' },
  sheen: { type: Number, default: 0.6 },
  depth: { type: Number, default: 0.6 },
  glow: { type: Number, default: 0.5 },
  ripple: { type: Number, default: 1 },
  wave: { type: Number, default: 1 },
  mouseInteraction: { type: Boolean, default: true },
  clickRipple: { type: Boolean, default: true },
});

const canvasRef = ref(null);
let gl = null, raf = 0;
let progField = null, progComp = null, fbo = null, fboTex = null;
let W = 0, H = 0, FW = 0, FH = 0;
let startTime = 0, lastT = 0;
const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: false, str: 0 };
const rippleList = [];

const VERT = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerStr;
uniform vec4 uRipples[4];
uniform float uWave;
uniform float uRippleAmt;
uniform float uSpeed;
float silkPat(vec2 tex){
  float t = uTime * uSpeed * 0.2;
  return 0.6 + 0.4 * uWave * sin(5.0 * (tex.x + tex.y + cos(3.0 * tex.x + 5.0 * tex.y) + 0.02 * t)
    + uRippleAmt * sin(20.0 * (tex.x + tex.y - 0.1 * t)));
}
vec2 bend(vec2 uv){
  if (uPointerStr > 0.001) {
    vec2 d = uv - uPointer;
    float dist = length(d);
    float touch = exp(-dist * dist * 14.0);
    uv -= (d / max(dist, 1e-4)) * touch * 0.10 * uPointerStr;
  }
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float age = uTime - r.z;
    if (age < 0.0 || age > 3.0) continue;
    vec2 rd = uv - r.xy;
    float rdist = length(rd);
    float front = rdist - age * 0.55;
    float amp = exp(-front * front * 45.0) * r.w * sin(front * 30.0) * exp(-age * 1.1) * 0.035;
    uv -= (rd / max(rdist, 1e-4)) * amp;
  }
  return uv;
}`;

const FRAG_FIELD = `#version 300 es
${COMMON}
uniform vec2 uRes;
out vec4 outColor;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = silkPat(bend(uv));
  outColor = vec4(pow(n, 6.0), 0.0, 0.0, 1.0);
}`;

const FRAG_COMP = `#version 300 es
${COMMON}
uniform vec2 uRes;
uniform sampler2D uBloom;
uniform vec3 uBase;
uniform vec3 uColor;
uniform vec3 uSheenColor;
uniform float uSheen;
uniform float uDepth;
uniform float uGlow;
uniform float uIntensity;
uniform float uIntro;
uniform vec2 uLightDir;
out vec4 outColor;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 bent = bend(uv);
  float stp = 0.0025;
  float n  = silkPat(bent);
  float nx = silkPat(bent + vec2(stp, 0.0));
  float ny = silkPat(bent + vec2(0.0, stp));
  vec3 N = normalize(vec3((n - nx) / stp * 0.08, (n - ny) / stp * 0.08, 1.0));
  vec3 L = normalize(vec3(uLightDir * 0.6, 0.8));
  float relief = max(dot(N, L), 0.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float gloss = pow(max(dot(N, H), 0.0), 48.0);
  float crest = smoothstep(0.78, 0.98, n);
  vec3 col = uBase;
  col += uColor * relief * 0.85 * uIntensity;
  col += uSheenColor * gloss * uSheen * uIntensity;
  col += uColor * crest * 0.18 * uIntensity;
  float b = textureLod(uBloom, uv, 1.0).r * 0.35
          + textureLod(uBloom, uv, 2.0).r * 0.30
          + textureLod(uBloom, uv, 3.0).r * 0.20
          + textureLod(uBloom, uv, 4.0).r * 0.15;
  col += uColor * b * uGlow * 1.3 * uIntensity;
  col *= uIntro;
  /* 软性色调映射：高光平滑收敛，涟漪冲高时不过曝，中间调不受影响 */
  col = 1.0 - exp(-col * 1.4);
  outColor = vec4(col, 1.0);
}`;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
function smootherstep(x) { return x * x * x * (x * (x * 6 - 15) + 10); }

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('silk shader:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
function makeProgram(fragSrc) {
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('silk link:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function createFBO() {
  if (fboTex) gl.deleteTexture(fboTex);
  if (fbo) gl.deleteFramebuffer(fbo);
  FW = Math.max(2, Math.floor(W / 4));
  FH = Math.max(2, Math.floor(H / 4));
  fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  const levels = Math.max(1, Math.floor(Math.log2(Math.max(FW, FH))) + 1);
  gl.texStorage2D(gl.TEXTURE_2D, Math.min(levels, 5), gl.RGBA8, FW, FH);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.floor(window.innerWidth * dpr);
  H = Math.floor(window.innerHeight * dpr);
  const c = canvasRef.value;
  c.width = W;
  c.height = H;
  createFBO();
}

function setCommonUniforms(prog, time) {
  gl.useProgram(prog);
  gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), time);
  gl.uniform2f(gl.getUniformLocation(prog, 'uPointer'), pointer.x, pointer.y);
  gl.uniform1f(gl.getUniformLocation(prog, 'uPointerStr'), pointer.str);
  const flat = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const r = rippleList[i];
    if (r) {
      flat[i * 4] = r.x; flat[i * 4 + 1] = r.y;
      flat[i * 4 + 2] = r.t0; flat[i * 4 + 3] = 1;
    }
  }
  gl.uniform4fv(gl.getUniformLocation(prog, 'uRipples'), flat);
  gl.uniform1f(gl.getUniformLocation(prog, 'uWave'), props.wave);
  gl.uniform1f(gl.getUniformLocation(prog, 'uRippleAmt'), props.ripple);
  gl.uniform1f(gl.getUniformLocation(prog, 'uSpeed'), props.speed);
}

function frame(t) {
  const time = (t - startTime) / 1000;
  const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
  lastT = t;
  const follow = 1 - Math.exp(-dt * 10);
  pointer.x += (pointer.tx - pointer.x) * follow;
  pointer.y += (pointer.ty - pointer.y) * follow;
  pointer.str += ((pointer.active ? 1 : 0) - pointer.str) * (1 - Math.exp(-dt * 6));
  const intro = smootherstep(Math.min(1, time / 2.2));
  const light = document.documentElement.classList.contains('light');
  // FIELD pass：1/4 分辨率泛光场
  setCommonUniforms(progField, time);
  gl.uniform2f(gl.getUniformLocation(progField, 'uRes'), FW, FH);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, FW, FH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  // COMPOSITE pass：全屏合成
  setCommonUniforms(progComp, time);
  gl.uniform2f(gl.getUniformLocation(progComp, 'uRes'), W, H);
  gl.uniform1i(gl.getUniformLocation(progComp, 'uBloom'), 0);
  gl.uniform3fv(gl.getUniformLocation(progComp, 'uBase'), hexToRgb(light ? '#f0f2fa' : '#0d1530'));
  gl.uniform3fv(gl.getUniformLocation(progComp, 'uColor'), hexToRgb(light ? props.lightColor : props.darkColor));
  gl.uniform3fv(gl.getUniformLocation(progComp, 'uSheenColor'), hexToRgb(light ? '#ffffff' : '#dfe6ff'));
  gl.uniform1f(gl.getUniformLocation(progComp, 'uSheen'), props.sheen);
  gl.uniform1f(gl.getUniformLocation(progComp, 'uDepth'), props.depth);
  gl.uniform1f(gl.getUniformLocation(progComp, 'uGlow'), props.glow);
  gl.uniform1f(gl.getUniformLocation(progComp, 'uIntensity'), light ? 0.42 : 1.0);
  gl.uniform1f(gl.getUniformLocation(progComp, 'uIntro'), intro);
  gl.uniform2f(gl.getUniformLocation(progComp, 'uLightDir'), (pointer.x - 0.5) * 2, (pointer.y - 0.5) * 2);
  gl.viewport(0, 0, W, H);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  raf = requestAnimationFrame(frame);
}

function onMove(e) {
  if (!props.mouseInteraction) return;
  pointer.tx = e.clientX / window.innerWidth;
  pointer.ty = 1 - e.clientY / window.innerHeight;
  pointer.active = true;
}
function onLeave() {
  pointer.active = false;
}
function onDown(e) {
  if (!props.clickRipple) return;
  rippleList.push({ x: e.clientX / window.innerWidth, y: 1 - e.clientY / window.innerHeight, t0: (performance.now() - startTime) / 1000 });
  if (rippleList.length > 4) rippleList.shift();
}

onMounted(() => {
  const c = canvasRef.value;
  gl = c.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) { c.style.display = 'none'; return; }
  progField = makeProgram(FRAG_FIELD);
  progComp = makeProgram(FRAG_COMP);
  if (!progField || !progComp) return;
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  startTime = performance.now();
  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  window.removeEventListener('resize', resize);
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerdown', onDown);
  document.removeEventListener('pointerleave', onLeave);
  if (fboTex) gl.deleteTexture(fboTex);
  if (fbo) gl.deleteFramebuffer(fbo);
});
</script>

<template>
  <canvas ref="canvasRef" class="silk-canvas" aria-hidden="true"></canvas>
</template>

<style scoped>
.silk-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 0;
}
</style>
