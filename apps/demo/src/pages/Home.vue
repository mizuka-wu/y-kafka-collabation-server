<template>
  <div class="home-container">
    <header class="hero">
      <h1>Y-Kafka Collaboration Demo</h1>
      <p>目前 Demo 仅提供架构概览，所有事件/降级逻辑将迁移到网关。</p>
    </header>

    <div class="demo-cards">
      <RouterLink to="/prosemirror" class="demo-card">
        <h2>文档视图（占位）</h2>
        <p>
          该页面后续将展示网关提供的快照/事件回放结果。
          <br />
          当前仅展示数据模型说明，不再直接触发任何 WebSocket/HTTP 事件。
        </p>
        <div class="tags">
          <span>Data Model</span>
          <span>Gateway Ready</span>
        </div>
      </RouterLink>

      <RouterLink to="/stress" class="demo-card">
        <h2>压力测试（占位）</h2>
        <p>
          压测逻辑将在网关层统一提供。
          <br />
          当前页面仅记录配置思路，不会主动创建任何连接。
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
        <li>协同事件的编码、发布、降级处理已迁移到服务端网关。</li>
        <li>Demo 仅承担静态说明职责，可安全用于文档或演示。</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>
