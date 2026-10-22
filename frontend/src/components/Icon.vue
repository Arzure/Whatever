<script setup>
// 统一图标组件：内联 SVG 线性图标，stroke 1.5px，继承 currentColor 自动适配深浅主题，零外部依赖
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 }
});
// 图标路径集：24x24 网格，线性风格，圆角端点
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  admin: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-2.5 9 2 2 3.5-4',
  save: 'M4 4h13l3 3v13H4V4Zm3 0v5h8V4M8 20v-6h8v6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.14-1.4l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L14.7 2H9.3l-.36 2.2a8 8 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6A8 8 0 0 0 4 12c0 .48.05.95.14 1.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.4 1.4L9.3 22h5.4l.36-2.2a8 8 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6c.09-.45.14-.92.14-1.4Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-13V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 1.4 1.4 1.4M4.9 4.9l1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  back: 'M15 4 7 12l8 8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  send: 'm3 11 18-8-8 18-2.5-7.5L3 11Z',
  close: 'M5 5l14 14M19 5 5 19',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  doc: 'M6 2h9l4 4v16H6V2Zm9 0v4h4M9 12h7M9 16h7',
  ppt: 'M4 3h16v14H8l-4 4V3Zm5 4h6m-6 4h6',
  resume: 'M6 2h12v20l-6-3-6 3V2Zm4 5h4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v.5m0 3v5',
  excel: 'M4 3h16v18H4V3Zm4 4 8 10m0-10-8 10',
  brush: 'M4 20c0-3 2-4 4-4l11-11 3 3L11 16c0 2-1 4-4 4H4Z',
  sword: 'm3 21 6-1L21 8l-4-4L5 16l-2 5Zm12-16 4 4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.8.2 4.2 4.3',
  trash: 'M4 6h16M9 6V4h6v2m-8 0 1 15h8l1-15M10 10v7m4-7v7',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 3v5h-5',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  copy: 'M8 8h12v12H8V8Zm-4 8V4h12',
  check: 'm4 12.5 5 5L20 6.5',
  warn: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.5',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 8.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  image: 'M4 5h16v14H4V5Zm0 10 5-5 4 4 3-3 4 4M9.5 9.5a1 1 0 1 0 0 .01'
};
</script>
<template>
  <svg class="ico" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="PATHS[name] || ''" />
  </svg>
</template>
<style scoped>
.ico {
  display: inline-block;
  vertical-align: -0.15em;
  flex-shrink: 0;
}
</style>
