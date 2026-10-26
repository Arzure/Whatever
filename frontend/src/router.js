import { createRouter, createWebHashHistory } from 'vue-router';

// 前端路由（hash 模式）：URL 与视图双向同步，支持刷新保持、直达链接、浏览器后退/前进
// 路由 name 与 game.state.view 的取值一一对应；story 为文字冒险进行中的独立视图
// detective/wolf/deduction/world 按 mode 渲染，不单独设路由（跟随 story）
const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'home' },
  { path: '/draw', name: 'draw' },
  { path: '/office', name: 'office' },
  { path: '/admin', name: 'admin' },
  { path: '/adventure', name: 'adventure' },
  { path: '/chat', name: 'chat' },
  { path: '/story', name: 'story' },
  { path: '/hub', name: 'hub' },
  { path: '/slash', name: 'slash' },
  { path: '/voxel', name: 'voxel' },
  { path: '/ironhold', name: 'ironhold' },
  { path: '/cube', name: 'cube' },
  { path: '/tower', name: 'tower' },
  { path: '/underrun', name: 'underrun' },
  { path: '/hexgl', name: 'hexgl' },
  { path: '/synthblast', name: 'synthblast' },
  { path: '/gorescript', name: 'gorescript' },
  { path: '/billiards', name: 'billiards' },
  { path: '/jump', name: 'jump' },
  { path: '/bloodwave', name: 'bloodwave' },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
