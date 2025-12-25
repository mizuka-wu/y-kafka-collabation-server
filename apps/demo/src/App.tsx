import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Y from 'yjs';
import { Awareness } from '@y/protocols/awareness';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import './styles.css';

const VITE_COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL ?? 'http://localhost:3000';
const DEMO_DOC_ID = 'demo-doc';

const toBase64 = (buffer: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < buffer.length; i += 1) {
    binary += String.fromCharCode(buffer[i]);
  }
  return window.btoa(binary);
};

type ServerStatus = {
  docId: string;
  kafkaMessageCount: number;
  latestSnapshot: string | null;
};

const fetchStatus = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/collab/status`);
  if (!response.ok) {
    throw new Error('状态请求失败');
  }
  return (await response.json()) as ServerStatus[];
};

const publishUpdate = async (
  baseUrl: string,
  docId: string,
  content: string,
) => {
  await fetch(`${baseUrl}/collab/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ docId, content }),
  });
};

const persistSnapshot = async (
  baseUrl: string,
  docId: string,
  snapshot: string,
) => {
  await fetch(`${baseUrl}/collab/persist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ docId, snapshot }),
  });
};

const App = () => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const ydoc = useMemo(() => new Y.Doc(), []);
  const awareness = useMemo(() => new Awareness(ydoc), [ydoc]);
  const [serverStatus, setServerStatus] = useState<ServerStatus[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('尚未发送');
  const featureCards = useMemo(
    () => [
      {
        title: 'Kafka + Socket.IO',
        body: 'transport 负责 metadata 补全与 Kafka produce/consume，RoomRegistry 在接收消息后精确路由到同 room 的 sockets。',
        accent: 'transport',
      },
      {
        title: 'Protocol Provider',
        body: 'ProtocolProvider 封装 yjs 同步、awareness 与 control 信令，负责 websocket 连接、重连、权限处理，紧密贴合 packages/provider。',
        accent: 'provider',
      },
      {
        title: 'Persistence & History',
        body: 'PersistenceCoordinator+PersistenceAdapter 写入 snapshots & update_history，供 recover/export 与 non-GC history service 使用。',
        accent: 'persistence',
      },
    ],
    [],
  );
  const timeline = useMemo(
    () => [
      {
        title: 'Client → Transport',
        description:
          '携带 roomId/docId/subdocId/version 的消息经 transport 编码为 Kafka envelope，并按 topic/partition 推送。',
      },
      {
        title: 'Kafka → Consumer',
        description:
          '所有实例订阅同 topic，consumer group 分配 partition，decode 后调用 RoomRegistry、trs 聚合 awareness/update。',
      },
      {
        title: 'Persistence & Replay',
        description:
          'doc update 写入数据库 snapshot/history，history service 保留 baseline，用于 recovery/export 和首次进入 room 的强同步。',
      },
    ],
    [],
  );

  const handlePersist = useCallback(async () => {
    const snapshot = JSON.stringify(ydoc.toJSON());
    setStatusMessage('正在持久化');
    await persistSnapshot(VITE_COLLAB_SERVER_URL, DEMO_DOC_ID, snapshot);
    setLastSync(new Date().toISOString());
    setStatusMessage('快照已保存');
  }, [ydoc]);

  const handleFetchStatus = useCallback(async () => {
    try {
      const status = await fetchStatus(VITE_COLLAB_SERVER_URL);
      setServerStatus(status);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    handleFetchStatus();
  }, [handleFetchStatus]);

  useEffect(() => {
    if (!editorRef.current) {
      return undefined;
    }
    const yXmlFragment = ydoc.getXmlFragment('prosemirror');
    const state = EditorState.create({
      schema: basicSchema,
      plugins: [
        ySyncPlugin(yXmlFragment),
        yCursorPlugin(awareness),
        yUndoPlugin(),
        history(),
        keymap(baseKeymap),
      ] as Plugin[],
    });
    const view = new EditorView(editorRef.current, {
      state,
    });
    return () => {
      view.destroy();
    };
  }, [awareness, ydoc]);

  useEffect(() => {
    const handleUpdate = (update: Uint8Array) => {
      const payload = toBase64(update);
      setStatusMessage('正在推送 update');
      publishUpdate(VITE_COLLAB_SERVER_URL, DEMO_DOC_ID, payload)
        .then(() => {
          setStatusMessage('Update 已推送');
          setLastSync(new Date().toISOString());
        })
        .catch((error) => {
          console.error(error);
          setStatusMessage('推送失败');
        });
    };
    ydoc.on('update', handleUpdate);
    return () => {
      ydoc.off('update', handleUpdate);
    };
  }, [ydoc]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Y-Kafka Collaboration Server</p>
          <h1>连接 provider 的高可用协作探索页</h1>
          <p>
            这个页面演示了 transport → Kafka → transport 流程中的文稿与
            awareness 同步，集成 ProtocolProvider 的 reconnect/metadata
            逻辑，并将 persistence 快照与 history service 可视化。
          </p>
          <div className="hero-actions">
            <button type="button" onClick={handleFetchStatus}>
              拉取服务状态
            </button>
            <a
              href="https://github.com/mizuka-wu/y-kafka-collabation-server/tree/main/packages/provider"
              target="_blank"
              rel="noreferrer"
            >
              查看 Provider 文档
            </a>
          </div>
        </div>
        <div className="hero-card">
          <p>协作服务器核心能力</p>
          <strong>Kafka + ProtocolProvider + Persistence</strong>
          <p>room/doc/subdoc/version/persistence metadata 全链路追踪。</p>
          <p>awareness 合并、aggregated broadcast、HTTP 降级一应俱全。</p>
        </div>
      </header>

      <section className="feature-grid">
        {featureCards.map((feature) => (
          <article
            key={feature.title}
            className={`feature-card feature-card_${feature.accent}`}
          >
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
            {feature.accent === 'provider' && (
              <p className="card-footnote">
                自动 connect、awareness 监听与权限处理由 ProtocolProvider
                控制，可直接接入 transport/kafka。
              </p>
            )}
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="editor-panel">
          <div className="editor-toolbar">
            <button type="button" onClick={handlePersist}>
              保存 Snapshot
            </button>
            <button type="button" onClick={handleFetchStatus}>
              立即拉取实时 Server 状态
            </button>
            <span className="status-chip">{statusMessage}</span>
          </div>
          <div ref={editorRef} className="editor" />
          <p className="editor-footnote">
            编辑器通过 ySyncPlugin 与 awareness 插件将更新发送到 Kafka，
            ProtocolProvider 可注册 awareness 事件并同步 cursor。
          </p>
        </article>

        <aside className="status-panel">
          <div className="status-header">
            <h2>Server 状态</h2>
            <p>最近同步：{lastSync ?? '尚未同步'}</p>
          </div>
          <ul>
            {serverStatus.map((entry) => (
              <li key={entry.docId}>
                <strong>{entry.docId}</strong>
                <span>Kafka 消息 {entry.kafkaMessageCount}</span>
                <span>
                  Snapshot {entry.latestSnapshot ? '已持久化' : '未生成'}
                </span>
              </li>
            ))}
          </ul>
          <div className="provider-card">
            <h3>ProtocolProvider 状态</h3>
            <p>
              自动重连：启用 · Metadata 自定义：可选 · Awareness 监听器：2 个
            </p>
            <div className="provider-badges">
              <span>autoConnect</span>
              <span>awareness</span>
              <span>permission-denied</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="timeline-panel">
        <h2>流转路径一目了然</h2>
        <p>
          参照 README 所述的 architecture 流程：socket ↔ kafka ↔ persistence，
          同时结合 provider 对 metadata 的补全与 control 信号。
        </p>
        <ol>
          {timeline.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
        <div className="link-grid">
          <a
            href="https://github.com/mizuka-wu/y-kafka-collabation-server/README.md"
            target="_blank"
            rel="noreferrer"
          >
            阅读 Architecture README
          </a>
          <a
            href="https://github.com/mizuka-wu/y-kafka-collabation-server/packages/provider/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Provider 实现细节
          </a>
        </div>
      </section>
    </div>
  );
};

export default App;
