import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as Y from '@y/y';
import { Awareness } from '@y/protocols/awareness';
import {
  ProtocolProvider,
  ProviderStatus,
  MultiplexedSocketManager,
  createVirtualWebSocketFactory,
} from '@y-kafka-collabation-server/provider';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import { fetchStatus, persistSnapshot, ServerStatus } from '../lib/api';

const VITE_COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL ?? 'http://localhost:3000';

export const ProsemirrorDemo = () => {
  const [docId, setDocId] = useState('demo-doc');
  const [inputDocId, setInputDocId] = useState(docId);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Re-create Y.Doc when docId changes to ensure clean state
  const ydoc = useMemo(() => new Y.Doc({ guid: docId }), [docId]);
  const awareness = useMemo(() => new Awareness(ydoc), [ydoc]);

  const [serverStatus, setServerStatus] = useState<ServerStatus[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('尚未发送');
  const [providerStatus, setProviderStatus] =
    useState<ProviderStatus>('disconnected');
  const [lastProviderSync, setLastProviderSync] = useState<string | null>(null);
  const [providerLog, setProviderLog] = useState<string[]>([]);

  const socketManager = useMemo(
    () => new MultiplexedSocketManager(VITE_COLLAB_SERVER_URL),
    [],
  );

  useEffect(() => {
    return () => {
      socketManager.disconnect();
    };
  }, [socketManager]);

  const handlePersist = useCallback(async () => {
    const snapshot = JSON.stringify(ydoc.toJSON());
    setStatusMessage('正在持久化');
    await persistSnapshot(VITE_COLLAB_SERVER_URL, docId, snapshot);
    setLastSync(new Date().toISOString());
    setStatusMessage('快照已保存');
  }, [ydoc, docId]);

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
    const interval = setInterval(handleFetchStatus, 5000);
    return () => clearInterval(interval);
  }, [handleFetchStatus]);

  useEffect(() => {
    if (!editorRef.current) return;

    // Cleanup previous editor if any (though usually re-mount handles this)
    editorRef.current.innerHTML = '';

    const yXmlFragment = ydoc.getXmlFragment('prosemirror');
    const state = EditorState.create({
      schema: basicSchema,
      plugins: [
        ySyncPlugin(yXmlFragment as any),
        yCursorPlugin(awareness as any),
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

  const pushProviderLog = useCallback((message: string) => {
    setProviderLog((prev) => {
      const next = [message, ...prev];
      return next.slice(0, 10);
    });
  }, []);

  useEffect(() => {
    // Reset logs on doc switch
    setProviderLog([]);
    setLastProviderSync(null);
    setProviderStatus('disconnected');

    const provider = new ProtocolProvider(ydoc, {
      url: `virtual://${docId}`,
      docId: docId,
      roomId: 'collab-doc', // Use 'collab-doc' as the room type/namespace
      WebSocketImpl: createVirtualWebSocketFactory(socketManager),
      awareness,
      metadataCustomizer: (metadata) => ({
        ...metadata,
        version: Date.now().toString(),
      }),
    });

    provider.on('status', (value) => {
      setProviderStatus(value);
      pushProviderLog(`状态：${value} · ${new Date().toLocaleTimeString()}`);
    });
    provider.on('sync', () => {
      setLastProviderSync(new Date().toISOString());
      pushProviderLog(`SyncStep2 完成 · ${new Date().toLocaleTimeString()}`);
    });
    provider.on('awareness', (changes) => {
      const touched = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ];
      pushProviderLog(
        `Awareness: ${touched.length ? touched.join(', ') : 'none'} · ${new Date().toLocaleTimeString()}`,
      );
    });

    return () => {
      provider.destroy();
    };
  }, [ydoc, docId, awareness, pushProviderLog]);

  const switchDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputDocId && inputDocId !== docId) {
      setDocId(inputDocId);
    }
  };

  return (
    <div className="demo-page">
      <header className="page-header">
        <h2>Prosemirror 协同编辑器</h2>
        <div className="doc-switcher">
          <form onSubmit={switchDoc}>
            <label>当前文档 ID: </label>
            <input
              value={inputDocId}
              onChange={(e) => setInputDocId(e.target.value)}
              placeholder="Enter Doc ID"
            />
            <button type="submit">切换文档</button>
          </form>
        </div>
      </header>

      <div className="content-grid">
        <article className="editor-panel">
          <div className="editor-toolbar">
            <button type="button" onClick={handlePersist}>
              保存 Snapshot
            </button>
            <span className="status-chip">{statusMessage}</span>
          </div>
          <div ref={editorRef} className="editor" />
          <p className="editor-footnote">
            当前连接到 Room: <strong>{docId}</strong>
          </p>
        </article>

        <aside className="status-panel">
          <div className="provider-card">
            <h3>ProtocolProvider 状态</h3>
            <p>
              连接状态：
              <span className={`status-${providerStatus}`}>
                {providerStatus}
              </span>
            </p>
            <p>
              上次同步：
              {lastProviderSync
                ? `${new Date(lastProviderSync).toLocaleTimeString()}`
                : '尚未完成'}
            </p>
            <div className="provider-log">
              {providerLog.map((entry, i) => (
                <div key={i} className="log-entry">
                  {entry}
                </div>
              ))}
            </div>
          </div>

          <div className="server-status-list">
            <h3>Server 活跃文档</h3>
            <ul>
              {serverStatus.map((entry) => (
                <li
                  key={entry.docId}
                  className={entry.docId === docId ? 'active' : ''}
                >
                  <strong>{entry.docId}</strong>
                  <div>Msgs: {entry.kafkaMessageCount}</div>
                  <div>Snap: {entry.latestSnapshot ? '✅' : '❌'}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
};
