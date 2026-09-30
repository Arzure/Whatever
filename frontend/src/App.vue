<script setup>
import { onMounted, provide } from 'vue';
import { useGame } from './composables/useGame';
import HomeView from './components/HomeView.vue';
import WorldView from './components/WorldView.vue';
import DetectiveView from './components/DetectiveView.vue';

const game = useGame();
provide('game', game);

onMounted(game.refreshSaves);
</script>

<template>
  <HomeView v-if="game.state.view === 'home'" />
  <DetectiveView v-else-if="game.state.mode === 'detective'" />
  <WorldView v-else />
</template>
