<template>
  <div class="demo-page">
    <header class="page-header">
      <h2>压力测试（静态占位）</h2>
      <p>
        自动化压测、降级验证将统一迁移到网关/Server 侧运行。
        该页面仅描述设计目标与配置约束，不再主动创建任何连接或事件。
      </p>
    </header>

    <section class="card">
      <h3>压测设计要点</h3>
      <ul>
        <li>并发客户端通过 ProtocolProvider 工厂生成，由网关统一注入 metadata。</li>
        <li>Kafka 压力与降级 HTTP 行为将在 Server 内部采样并输出指标。</li>
        <li>Demo 只读取网关暴露的压测报告，避免直接接入 Kafka。</li>
      </ul>
    </section>

    <section class="card">
      <h3>压测控制 (Active Clients: {{ clients.length }})</h3>
      <div class="controls">
        <button @click="addClient">Add Client</button>
        <button @click="clearClients">Clear Clients</button>
      </div>
    </section>

    <section class="card">
      <h3>网关待实现能力</h3>
      <ol>
        <li>模拟多租户、多 room 的连接矩阵。</li>
        <li>对每条 ProtocolMessage 记录发送/消费延迟。</li>
        <li>根据配置切换 WebSocket / HTTP 降级路径。</li>
      </ol>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { YKafkaCollabationProvider } from '@y-kafka-collabation-server/provider';
import { YDoc } from 'ywasm';

const clients = ref<any[]>([]);

const addClient = () => {
  const doc = new YDoc({});
  const clientId = clients.value.length + 1;
  const provider = new YKafkaCollabationProvider(
    'http://localhost:3000',
    `stress-test-room/doc-${clientId}`,
    doc,
    {
      connect: true,
      params: { type: 'stress-test' },
    }
  );

  clients.value.push({ doc, provider, id: clientId });
  console.log(`[StressTest] Client ${clientId} added`);
};

const clearClients = () => {
  clients.value.forEach(c => {
    c.provider.destroy();
    c.doc.free();
  });
  clients.value = [];
};

onUnmounted(() => {
  clearClients();
});
</script>

<style scoped>
.controls {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
}

button {
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.card {
  padding: 1.5rem;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.card ul,
.card ol {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--text-main);
  line-height: 1.6;
}
</style>
