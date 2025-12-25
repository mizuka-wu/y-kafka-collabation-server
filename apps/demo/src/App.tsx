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
      <header>
        <h1>Y Kafka Collaboration Demo</h1>
        <p>向服务端发送 ProseMirror 更新并以 REST 提供 Kafka/MySQL 视角。</p>
      </header>

      <section className="editor-panel">
        <div className="editor-toolbar">
          <button type="button" onClick={handlePersist}>
            保存 Snapshot
          </button>
          <button type="button" onClick={handleFetchStatus}>
            拉取服务状态
          </button>
          <span className="status-chip">{statusMessage}</span>
        </div>
        <div ref={editorRef} className="editor" />
      </section>

      <section className="status-panel">
        <h2>Server 状态</h2>
        <p>最近同步：{lastSync ?? '尚未同步'}</p>
        <ul>
          {serverStatus.map((entry) => (
            <li key={entry.docId}>
              {entry.docId} · Kafka 消息 {entry.kafkaMessageCount} · Latest
              snapshot: {entry.latestSnapshot ? '存在' : '暂无'}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default App;
