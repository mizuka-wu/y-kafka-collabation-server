import React from 'react';
import { Link } from 'react-router-dom';

export const Home = () => {
  return (
    <div className="home-container">
      <header className="hero">
        <h1>Y-Kafka Collaboration Demo</h1>
        <p>基于 Kafka + ProtocolProvider 的高可用协同服务演示</p>
      </header>

      <div className="demo-cards">
        <Link to="/prosemirror" className="demo-card">
          <h2>Prosemirror 协同</h2>
          <p>
            经典的富文本协同场景。
            <br />
            集成 y-prosemirror, 支持 Awareness 光标同步, 历史记录,
            和快照持久化。
          </p>
          <div className="tags">
            <span>Doc Switching</span>
            <span>History</span>
            <span>Persistence</span>
          </div>
        </Link>

        <Link to="/blocksuite" className="demo-card">
          <h2>BlockSuite (Subdoc)</h2>
          <p>
            基于 BlockSuite 的块级编辑器。
            <br />
            演示 Subdoc 加载机制, 大文档拆分协同, 以及高并发下的性能表现。
          </p>
          <div className="tags">
            <span>Subdocs</span>
            <span>Lazy Loading</span>
            <span>Performance</span>
          </div>
        </Link>

        <Link to="/stress" className="demo-card">
          <h2>压力测试</h2>
          <p>
            模拟多客户端并发连接与更新。
            <br />
            测试 Server 的连接承载能力与 Kafka 消息吞吐量。
          </p>
          <div className="tags">
            <span>High Concurrency</span>
            <span>Stress Test</span>
          </div>
        </Link>
      </div>

      <div className="architecture-info">
        <h3>架构亮点</h3>
        <ul>
          <li>
            <strong>Transport:</strong> 全双工通信，负责将客户端操作封装为 Kafka
            消息。
          </li>
          <li>
            <strong>Kafka:</strong> 消息队列削峰填谷，保证顺序性和高吞吐。
          </li>
          <li>
            <strong>ProtocolProvider:</strong>{' '}
            客户端智能连接管理，断线重连，Metadata 注入。
          </li>
        </ul>
      </div>
    </div>
  );
};
