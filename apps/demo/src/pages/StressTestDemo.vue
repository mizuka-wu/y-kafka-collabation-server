<template>
  <div class="demo-page">
    <header class="page-header">
      <h2>压力测试 & 高并发演示</h2>
    </header>

    <div class="stress-controls card">
      <div class="control-row">
        <label>
          模拟客户端数量:
          <input type="number" v-model.number="clientCount" :disabled="isRunning" min="1" max="100" />
        </label>
        <label>
          目标 DocID:
          <input v-model="docId" :disabled="isRunning" />
        </label>
        <button :class="{ danger: isRunning }" @click="toggleTest">
          {{ isRunning ? '停止测试' : '开始测试' }}
        </button>
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <h4>连接数</h4>
          <div class="metric-value">{{ connectedCount }} / {{ clientCount }}</div>
        </div>
        <div class="metric-card">
          <h4>总发送更新</h4>
          <div class="metric-value">{{ totalUpdates }}</div>
        </div>
        <div class="metric-card">
          <h4>状态</h4>
          <div class="metric-value" :class="{ success: isRunning }">
            {{ isRunning ? 'Running' : 'Idle' }}
          </div>
        </div>
      </div>
    </div>

    <div class="client-grid">
      <div v-for="client in stats" :key="client.id" class="client-card" :class="client.status">
        <div class="client-header">
          <strong>Client #{{ client.id }}</strong>
          <span class="status-label">{{ client.status }}</span>
        </div>
        <div>Updates: {{ client.updatesSent }}</div>
        <div v-if="client.lastError" class="error-text">{{ client.lastError }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, computed } from 'vue';
import * as Y from 'yjs';
import {
  ProtocolProvider,
  ProviderStatus,
} from '@y-kafka-collabation-server/provider';

const VITE_COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL ?? 'http://localhost:3000';

type ClientStats = {
  id: number;
  status: ProviderStatus;
  updatesSent: number;
  lastError?: string;
};

const clientCount = ref(10);
const isRunning = ref(false);
const docId = ref('stress-test-doc');
const stats = reactive<ClientStats[]>([]);

const clients: ProtocolProvider[] = [];
let interval: ReturnType<typeof setInterval> | null = null;

const resetStats = () => {
  stats.splice(
    0,
    stats.length,
    ...Array.from({ length: clientCount.value }, (_, i) => ({
      id: i,
      status: 'disconnected' as ProviderStatus,
      updatesSent: 0,
    })),
  );
};

const startTest = () => {
  if (isRunning.value) return;
  isRunning.value = true;
  resetStats();

  for (let i = 0; i < clientCount.value; i++) {
    const ydoc = new Y.Doc({ guid: docId.value });
    const provider = new ProtocolProvider(ydoc, {
      url: VITE_COLLAB_SERVER_URL,
      docId: docId.value,
      roomId: 'stress',
      autoConnect: true,
    });

    provider.on('status', (status) => {
      const target = stats.find((s) => s.id === i);
      if (target) {
        target.status = status;
      }
    });

    provider.on('error', (error) => {
      const target = stats.find((s) => s.id === i);
      if (target) {
        target.lastError = String(error);
      }
    });

    clients[i] = provider;
  }

  interval = setInterval(() => {
    clients.forEach((provider, index) => {
      if (provider.status === 'connected' && Math.random() > 0.7) {
        const ymap = provider.doc.getMap('stress-map');
        ymap.set(`client-${index}`, Date.now());

        const target = stats.find((s) => s.id === index);
        if (target) {
          target.updatesSent += 1;
        }
      }
    });
  }, 100);
};

const stopTest = () => {
  isRunning.value = false;
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  clients.forEach((p) => p.destroy());
  clients.length = 0;
};

const toggleTest = () => {
  if (isRunning.value) {
    stopTest();
  } else {
    startTest();
  }
};

const connectedCount = computed(
  () => stats.filter((s) => s.status === 'connected').length,
);

const totalUpdates = computed(
  () => stats.reduce((acc, s) => acc + s.updatesSent, 0),
);

onBeforeUnmount(() => {
  stopTest();
});
</script>

<style scoped>
.card {
  padding: 1.5rem;
  background: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.control-row {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.control-row label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}

.control-row input {
  padding: 0.5rem;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  color: var(--text-main);
  border-radius: 4px;
}

.control-row button {
  background: var(--success);
  color: white;
  border: none;
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
}

.control-row button.danger {
  background: var(--warning);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.metric-card {
  background: var(--bg-dark);
  padding: 1rem;
  border-radius: 4px;
}

.metric-card h4 {
  margin: 0;
  color: var(--text-muted);
}

.metric-value {
  font-size: 2rem;
  font-weight: bold;
}

.metric-value.success {
  color: var(--success);
}

.client-grid {
  margin-top: 2rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
}

.client-card {
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.client-card.connected {
  border-left: 4px solid var(--success);
}

.client-card.connecting {
  border-left: 4px solid var(--warning);
}

.client-card.disconnected {
  border-left: 4px solid var(--text-muted);
}

.client-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.status-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.error-text {
  font-size: 0.75rem;
  color: #ef4444;
  margin-top: 0.5rem;
}
</style>
