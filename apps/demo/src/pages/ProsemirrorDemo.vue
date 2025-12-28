<template>
  <div class="demo-page">
    <header class="page-header">
      <h2>Prosemirror 协同编辑器</h2>
      <div class="doc-switcher">
        <form @submit.prevent="switchDoc">
          <label>当前文档 ID: </label>
          <input v-model="inputDocId" placeholder="Enter Doc ID" />
          <button type="submit">切换文档</button>
        </form>
      </div>
    </header>

    <div class="content-grid">
      <article class="editor-panel">
        <div class="editor-toolbar">
          <button type="button" @click="handlePersist">保存 Snapshot</button>
          <span class="status-chip">{{ statusMessage }}</span>
        </div>
        <div ref="editorRef" class="editor" />
        <p class="editor-footnote">
          当前连接到 Room: <strong>{{ docId }}</strong>
        </p>
      </article>

      <aside class="status-panel">
        <div class="provider-card">
          <h3>ProtocolProvider 状态</h3>
          <p>
            连接状态：
            <span :class="`status-${providerStatus}`">
              {{ providerStatus }}
            </span>
          </p>
          <p>
            上次同步：
            {{ lastProviderSync ? new Date(lastProviderSync).toLocaleTimeString() : '尚未完成' }}
          </p>
          <div class="provider-log">
            <div v-for="(entry, index) in providerLog" :key="index" class="log-entry">
              {{ entry }}
            </div>
          </div>
        </div>

        <div class="server-status-list">
          <h3>Server 活跃文档</h3>
          <ul>
            <li v-for="entry in serverStatus" :key="entry.docId" :class="{ active: entry.docId === docId }">
              <strong>{{ entry.docId }}</strong>
              <div>Msgs: {{ entry.kafkaMessageCount }}</div>
              <div>Snap: {{ entry.latestSnapshot ? '✅' : '❌' }}</div>
            </li>
          </ul>
        </div>

        <div class="http-panel">
          <h3>HTTP 降级状态</h3>
          <button type="button" @click="refreshDocumentState">刷新 HTTP 状态</button>
          <div v-if="documentState" class="http-details">
            <p>快照：{{ documentState.snapshot ? '存在' : '无' }}</p>
            <p>历史 Updates：{{ documentState.updates.length }}</p>
            <p>Kafka Aggregated：{{ documentState.kafkaUpdates.length }}</p>
            <p v-if="documentState.kafkaTail">
              Kafka Tail：{{ documentState.kafkaTail.topic }} / P{{ documentState.kafkaTail.partition }} @
              {{ documentState.kafkaTail.offset }}
            </p>
            <p v-else>Kafka Tail：暂无</p>
          </div>
          <div v-else class="http-details">
            <p>尚未加载 HTTP 状态</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'prosemirror-view/style/prosemirror.css';
import { ref, shallowRef, watch, watchEffect, onMounted, onBeforeUnmount } from 'vue';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  ProtocolProvider,
  ProviderStatus,
} from '@y-kafka-collabation-server/provider';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  initProseMirrorDoc,
  undo,
  redo,
} from 'y-prosemirror';
import {
  fetchStatus,
  fetchDocumentState,
  persistSnapshot,
  DocumentState,
  ServerStatus,
} from '../lib/api';

const VITE_COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL ?? 'http://localhost:3000';

const docId = ref('demo-doc');
const inputDocId = ref(docId.value);

const editorRef = ref<HTMLDivElement | null>(null);
const editorView = shallowRef<EditorView | null>(null);
const ydoc = shallowRef<Y.Doc>();
const awareness = shallowRef<Awareness>();
const provider = shallowRef<ProtocolProvider | null>(null);

const serverStatus = ref<ServerStatus[]>([]);
const documentState = ref<DocumentState | null>(null);
const statusMessage = ref('尚未发送');
const providerStatus = ref<ProviderStatus>('disconnected');
const lastProviderSync = ref<string | null>(null);
const providerLog = ref<string[]>([]);
let statusInterval: ReturnType<typeof setInterval> | null = null;
const lastSnapshotVersion = ref<string | null>(null);

const recreateCollabState = (id: string) => {
  ydoc.value = new Y.Doc({ guid: id });
  awareness.value = new Awareness(ydoc.value);
};

recreateCollabState(docId.value);

watch(docId, (id) => {
  if (id) {
    recreateCollabState(id);
  }
});

const pushProviderLog = (message: string) => {
  providerLog.value = [message, ...providerLog.value].slice(0, 10);
};

const refreshDocumentState = async () => {
  try {
    documentState.value = await fetchDocumentState(
      VITE_COLLAB_SERVER_URL,
      docId.value,
    );
  } catch (error) {
    console.error(error);
  }
};

const handlePersist = async () => {
  if (!ydoc.value) return;
  const snapshot = JSON.stringify(ydoc.value.toJSON());
  const version =
    lastSnapshotVersion.value ?? Date.now().toString();
  statusMessage.value = '正在持久化';
  await persistSnapshot(
    VITE_COLLAB_SERVER_URL,
    docId.value,
    snapshot,
    version,
  );
  lastSnapshotVersion.value = version;
  statusMessage.value = '快照已保存';
  await refreshDocumentState();
};

const handleFetchStatus = async () => {
  try {
    serverStatus.value = await fetchStatus(VITE_COLLAB_SERVER_URL);
  } catch (error) {
    console.error(error);
  }
};

onMounted(() => {
  handleFetchStatus();
  statusInterval = setInterval(handleFetchStatus, 5000);
  refreshDocumentState();
});

watchEffect((onCleanup) => {
  const container = editorRef.value;
  const doc = ydoc.value;
  const aw = awareness.value;
  if (!container || !doc || !aw) {
    return;
  }

  container.innerHTML = '';
  const fragment = doc.getXmlFragment('prosemirror');
  const { doc: initialDoc, mapping } = initProseMirrorDoc(
    fragment as any,
    basicSchema,
  );

  const state = EditorState.create({
    schema: basicSchema,
    doc: initialDoc,
    plugins: [
      ySyncPlugin(fragment as any, { mapping }),
      yCursorPlugin(aw as any),
      yUndoPlugin(),
      history(),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Mod-Shift-z': redo,
      }),
      keymap(baseKeymap),
    ],
  });

  const view = new EditorView(container, { state });
  editorView.value = view;

  onCleanup(() => {
    view.destroy();
    if (editorView.value === view) {
      editorView.value = null;
    }
  });
});

watchEffect((onCleanup) => {
  const doc = ydoc.value;
  const aw = awareness.value;
  const currentDocId = docId.value;
  if (!doc || !aw) {
    return;
  }

  providerLog.value = [];
  lastProviderSync.value = null;
  providerStatus.value = 'disconnected';

  const instance = new ProtocolProvider(doc, {
    url: VITE_COLLAB_SERVER_URL,
    docId: currentDocId,
    roomId: 'collab-doc',
    awareness: aw,
    metadataCustomizer: (metadata) => ({
      ...metadata,
      version: Date.now().toString(),
    }),
  });

  instance.on('status', (value) => {
    providerStatus.value = value;
    pushProviderLog(`状态：${value} · ${new Date().toLocaleTimeString()}`);
  });
  instance.on('sync', () => {
    lastProviderSync.value = new Date().toISOString();
    pushProviderLog(`SyncStep2 完成 · ${new Date().toLocaleTimeString()}`);
  });
  instance.on('awareness', (changes) => {
    const touched = [
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ];
    pushProviderLog(
      `Awareness: ${touched.length ? touched.join(', ') : 'none'
      } · ${new Date().toLocaleTimeString()}`,
    );
  });

  provider.value = instance;
  refreshDocumentState();

  onCleanup(() => {
    instance.destroy();
    if (provider.value === instance) {
      provider.value = null;
    }
  });
});

const switchDoc = () => {
  if (inputDocId.value && inputDocId.value !== docId.value) {
    docId.value = inputDocId.value;
    refreshDocumentState();
  }
};

onBeforeUnmount(() => {
  provider.value?.destroy();
  provider.value = null;
  editorView.value?.destroy();
  editorView.value = null;
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
});
</script>
