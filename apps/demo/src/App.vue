<template>
  <div class="app-shell">
    <nav class="main-nav">
      <div class="nav-brand">
        <RouterLink to="/">Y-Kafka Collab</RouterLink>
      </div>
      <div class="nav-links">
        <RouterLink
          to="/prosemirror"
          :class="{ active: route.path === '/prosemirror' }"
        >
          Prosemirror
        </RouterLink>
        <RouterLink
          to="/stress"
          :class="{ active: route.path === '/stress' }"
        >
          Stress Test
        </RouterLink>
      </div>
    </nav>

    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';

const route = useRoute();
</script>
