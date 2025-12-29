<template>
  <div class="demo-page">
    <header class="page-header">
      <h2>文档视图（静态占位）</h2>
      <p>
        Prosemirror 协同演示已下线，所有事件与降级能力将统一由新的网关层实现。
        此页面仅保留数据模型与流程说明，方便对照 README。
      </p>
    </header>

    <section class="card">
      <h3>ProtocolMessage 元数据字段</h3>
      <table class="metadata-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in metadataFields" :key="field.key">
            <td>{{ field.key }}</td>
            <td>{{ field.description }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h3>后续工作</h3>
      <ol>
        <li>在网关层实现 WebSocket 事件、降级 HTTP 回放与权限校验。</li>
        <li>Demo 仅消费网关输出的快照/回放数据，不直连 Kafka。</li>
        <li>待网关完成后，再恢复 Prosemirror 视图与交互逻辑。</li>
      </ol>
    </section>
  </div>
</template>

<script setup lang="ts">
const metadataFields = [
  { key: 'roomId', description: '逻辑文档集合，用于 Topic 路由。' },
  { key: 'docId', description: '具体 Y.Doc 标识。' },
  { key: 'subdocId', description: '可选子树/分片。' },
  { key: 'channel', description: 'doc / awareness / control。' },
  { key: 'version', description: '单调递增版本，用于持久化排序。' },
  { key: 'senderId', description: '客户端或服务节点 ID，用于去重。' },
  { key: 'timestamp', description: '事件时间戳（毫秒）。' },
];
</script>
