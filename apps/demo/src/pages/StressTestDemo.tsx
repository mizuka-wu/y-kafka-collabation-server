import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from '@y/y';
import {
  ProtocolProvider,
  ProviderStatus,
} from '@y-kafka-collabation-server/provider';
import { SocketIoWebSocket } from '../socketIoWebSocket';

const VITE_COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL ?? 'http://localhost:3000';

type ClientStats = {
  id: number;
  status: ProviderStatus;
  updatesSent: number;
  lastError?: string;
};

export const StressTestDemo = () => {
  const [clientCount, setClientCount] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [docId, setDocId] = useState('stress-test-doc');
  const [stats, setStats] = useState<ClientStats[]>([]);
  const clientsRef = useRef<ProtocolProvider[]>([]);
  const intervalRef = useRef<NodeJS.Timeout>();

  const startTest = useCallback(() => {
    if (isRunning) return;

    setIsRunning(true);
    setStats(
      Array.from({ length: clientCount }, (_, i) => ({
        id: i,
        status: 'disconnected',
        updatesSent: 0,
      })),
    );

    const newClients: ProtocolProvider[] = [];

    for (let i = 0; i < clientCount; i++) {
      const ydoc = new Y.Doc();
      const provider = new ProtocolProvider(ydoc, {
        url: `${VITE_COLLAB_SERVER_URL}/socket.io/?room=${docId}`,
        docId: docId,
        roomId: 'stress',
        WebSocketImpl: SocketIoWebSocket,
        autoConnect: true,
      });

      provider.on('status', (status) => {
        setStats((prev) =>
          prev.map((s) => (s.id === i ? { ...s, status } : s)),
        );
      });

      provider.on('error', (error) => {
        setStats((prev) =>
          prev.map((s) =>
            s.id === i ? { ...s, lastError: String(error) } : s,
          ),
        );
      });

      newClients.push(provider);
    }

    clientsRef.current = newClients;

    // Simulate activity
    intervalRef.current = setInterval(() => {
      newClients.forEach((provider, index) => {
        if (provider.status === 'connected' && Math.random() > 0.7) {
          const ymap = provider.doc.getMap('stress-map');
          ymap.set(`client-${index}`, Date.now());

          setStats((prev) =>
            prev.map((s) =>
              s.id === index ? { ...s, updatesSent: s.updatesSent + 1 } : s,
            ),
          );
        }
      });
    }, 100);
  }, [clientCount, docId, isRunning]);

  const stopTest = useCallback(() => {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    clientsRef.current.forEach((p) => p.destroy());
    clientsRef.current = [];
  }, []);

  useEffect(() => {
    return () => stopTest();
  }, [stopTest]);

  const connectedCount = stats.filter((s) => s.status === 'connected').length;
  const totalUpdates = stats.reduce((acc, s) => acc + s.updatesSent, 0);

  return (
    <div className="demo-page">
      <header className="page-header">
        <h2>压力测试 & 高并发演示</h2>
      </header>

      <div
        className="stress-controls"
        style={{
          padding: '1.5rem',
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <div>
            <label>模拟客户端数量: </label>
            <input
              type="number"
              value={clientCount}
              onChange={(e) => setClientCount(Number(e.target.value))}
              disabled={isRunning}
              min={1}
              max={100}
              style={{
                padding: '0.5rem',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border)',
                color: 'var(--text-main)',
                borderRadius: '4px',
              }}
            />
          </div>
          <div>
            <label>目标 DocID: </label>
            <input
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              disabled={isRunning}
              style={{
                padding: '0.5rem',
                background: 'var(--bg-dark)',
                border: '1px solid var(--border)',
                color: 'var(--text-main)',
                borderRadius: '4px',
              }}
            />
          </div>
          <button
            onClick={isRunning ? stopTest : startTest}
            style={{
              background: isRunning ? 'var(--warning)' : 'var(--success)',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1.5rem',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {isRunning ? '停止测试' : '开始测试'}
          </button>
        </div>

        <div
          className="metrics-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1rem',
          }}
        >
          <div
            className="metric-card"
            style={{
              background: 'var(--bg-dark)',
              padding: '1rem',
              borderRadius: '4px',
            }}
          >
            <h4 style={{ margin: 0, color: 'var(--text-muted)' }}>连接数</h4>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {connectedCount} / {clientCount}
            </div>
          </div>
          <div
            className="metric-card"
            style={{
              background: 'var(--bg-dark)',
              padding: '1rem',
              borderRadius: '4px',
            }}
          >
            <h4 style={{ margin: 0, color: 'var(--text-muted)' }}>
              总发送更新
            </h4>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {totalUpdates}
            </div>
          </div>
          <div
            className="metric-card"
            style={{
              background: 'var(--bg-dark)',
              padding: '1rem',
              borderRadius: '4px',
            }}
          >
            <h4 style={{ margin: 0, color: 'var(--text-muted)' }}>状态</h4>
            <div
              style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: isRunning ? 'var(--success)' : 'var(--text-muted)',
              }}
            >
              {isRunning ? 'Running' : 'Idle'}
            </div>
          </div>
        </div>
      </div>

      <div
        className="client-grid"
        style={{
          marginTop: '2rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '1rem',
        }}
      >
        {stats.map((client) => (
          <div
            key={client.id}
            style={{
              padding: '1rem',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              borderLeft: `4px solid ${client.status === 'connected' ? 'var(--success)' : client.status === 'connecting' ? 'var(--warning)' : 'var(--text-muted)'}`,
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Client #{client.id}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {client.status}
            </div>
            <div style={{ fontSize: '0.9rem' }}>
              Updates: {client.updatesSent}
            </div>
            {client.lastError && (
              <div
                style={{
                  fontSize: '0.7rem',
                  color: '#ef4444',
                  marginTop: '0.5rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {client.lastError}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
