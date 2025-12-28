<template>
  <div class="home-container">
    <header class="hero">
      <h1>Y-Kafka Collaboration Demo</h1>
      <p>基于 Kafka + ProtocolProvider 的高可用协同服务演示</p>
      <label class="awareness-toggle">
        <input type="checkbox" v-model="disableAwareness" />
        以 disableAwareness=1 打开 Demo
      </label>
    </header>

    <div class="demo-cards">
      <RouterLink :to="prosemirrorLink" class="demo-card">
        <h2>Prosemirror 协同</h2>
        <p>
          经典的富文本协同场景。
          <br />
          集成 y-prosemirror，支持 Awareness 光标同步、历史记录与快照持久化。
        </p>
        <div class="tags">
          <span>Doc Switching</span>
          <span>History</span>
          <span>Persistence</span>
        </div>
      </RouterLink>

      <RouterLink to="/stress" class="demo-card">
        <h2>压力测试</h2>
        <p>
          模拟多客户端并发连接与更新。
          <br />
          测试 Server 的连接承载能力与 Kafka 消息吞吐量。
        </p>
        <div class="tags">
          <span>High Concurrency</span>
          <span>Stress Test</span>
        </div>
      </RouterLink>
    </div>

    <div class="architecture-info">
      <h3>架构亮点</h3>
      <ul>
        <li>
          <strong>Transport:</strong>
          全双工通信，负责将客户端操作封装为 Kafka 消息。
        </li>
        <li>
          <strong>Kafka:</strong>
          消息队列削峰填谷，保证顺序性和高吞吐。
        </li>
        <li>
          <strong>ProtocolProvider:</strong>
          客户端智能连接管理，断线重连，Metadata 注入。
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { computed, ref } from 'vue';

const disableAwareness = ref(false);
const prosemirrorLink = computed(() => ({
  path: '/prosemirror',
  query: disableAwareness.value ? { disableAwareness: '1' } : {},
}));
</script>
