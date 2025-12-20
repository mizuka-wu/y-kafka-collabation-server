# @y-kafka-collabation-server 协议层

## 目标

基于 [y-websocket](https://github.com/yjs/y-websocket) 的协议思想，打造一套面向 Yjs 文档的同步层：

1. **抽象出协议扇区**（连接管理、状态事件、同步/ack、Awareness 广播等），为多客户端同步提供统一 contract。
2. **将协议层作为 Kafka 消息的生产者/消费者**，让所有文档更新都能通过 Kafka 传播到订阅的集群节点。
3. **为持久化提供 Hook**，将最终的状态写入数据库（例如 Redis、PostgreSQL）以便恢复和历史审计。

## y-websocket 核心契约

协议层需要复刻 y-websocket 的以下关键组件：

| 组件 | 描述 | 实现要点 |
| --- | --- | --- |
| WebsocketProvider | 客户端端点，负责连接、断线重试、send/receive 逻辑 | 统一连接状态 `status` 事件、`connect()`/`disconnect()`、`sync`/`awareness` 消息分流 |
| wsOpts | 可配置项，如 `params`、`WebsocketPolyfill`、`maxBackoffTime` | 改为 Kafka 相关参数（topic、group、重试策略等） |
| Event Hooks | `status`, `sync`, `connection-close`, `connection-error` | 保留，适配 Kafka 流的生命周期事件 |
| Awareness | y-protocols 的 Awareness，用于广播成员状态 | 通过 Kafka topic 统一广播 awareness 消息并在本地缓存 |

## 协议层构建块（Protocol Layer）

1. **连接层**：维护一个抽象 `ProtocolConnection`（类似 Websocket），负责 subscribe/consume Kafka topic（例如 `yjs-doc-{room}`）、处理回退逻辑与延迟补偿。
2. **消息层**：解析 Yjs Update 消息与 Awareness 消息，按 y-websocket 格式封包，并提供 `onSync`, `onAwareness` 等事件。
3. **状态层**：维护本地 `Y.Doc`，用于应用 update、生成 update 后发送给 Kafka，及定期和 Kafka 的 `synced` 状态同步。
4. **事件层**：暴露 `status` / `connection-close` / `error` 等事件，用于上层 UI 或服务组件做健康检测。

## 与 Kafka 交互的契约

1. **主题规划**
   - `yjs-doc-{room}`：传输 Yjs update 消息（可编码 base64 或二进制）。
   - `yjs-awareness-{room}`：广播 Awareness 状态（JSON）。
   - `yjs-control-{room}`：可选的控制通道（例如强制同步、版本校验）。

2. **生产者行为**
   - 每收到 doc update，立即 `produce` 到 `yjs-doc-{room}`。
   - Awareness 状态变化时 `produce` 到 awareness topic。
   - 可附加 metadata（senderId、version、timestamp），便于 Kafka 消费方过滤。

3. **消费者行为**
   - 订阅房间对应 topic。
   - 按序处理 update：先写入本地 `Y.Doc`，再触发 `sync` 事件。
   - 必要时需要过滤自身发送（可用 senderId）。

4. **一致性保障**
   - Kafka 消费位点可作为同步 offset，避免重复/丢失。
   - 通过 `synced` 事件告知上层已追上 log。

## 协议消息结构

原生 y-websocket 在 websocket 帧内用二进制封装消息头（message type）+ payload。我们在 Kafka 版协议中也应保持类似结构。

1. **Doc Update 消息**
   - `type`: `0`（与 y-websocket 保持一致，用于 Update 或 Sync Step 1**）
   - `doc`: 经过 `Y.encodeStateAsUpdate` 的 `Uint8Array`，可以直接写入 `Y.Doc.applyUpdate`
   - `senderId`: 发送者唯一标识，用于本地过滤，避免自回放
   - `version`: 当前 update 所处的版本（可选，用于差异检查）
   - `timestamp`: 事件时间，便于顺序对比

2. **Awareness 消息**
   - `type`: `1`
   - `payload`: Awareness 协议导出的状态（Awareness.encodeAwarenessUpdate）
   - `docId`: 所属文档/房间
   - `senderId` + `timestamp`
   - `action`: `update`/`remove`，区分加入、离开以及 state 变化

3. **Control 消息（可选）**
   - `type`: `2`
   - `command`: `sync` / `snapshot` / `revalidate`
   - `params`: JSON object（如需要告知 snapshot checkpoint、期望 version 等）
   - `replyTo`: 可选，用于将控制响应路由回请求方

消息统一封包格式也可以采用 JSON + Base64 payload，便于 Kafka 监控与调试。每条消息应包含 yjs docId、room、senderId 和版本信息，确保在多节点间重放和持久化都能对齐。

## 消息编码 / 解码实现示例

根据 `src/y-websocket.js` 的 `messageHandlers` 实现，我们应为每类消息明确编码/解码流程，确保和原始 WebSocket 协议兼容：

| 消息类型 | 处理入口 | 核心 API | 说明 |
| --- | --- | --- | --- |
| Sync | `syncProtocol.readSyncMessage` / `syncProtocol.writeSyncStep1` | `encoding.writeVarUint` / `encoding.toUint8Array` | 先写入消息类型 `0`，然后委托 syncProtocol 生成/解析 `SyncStep1/2` 的二进制 payload。|
| Awareness | `awarenessProtocol.encodeAwarenessUpdate` / `applyAwarenessUpdate` | `encoding.writeVarUint8Array` | 将 awareness state 编码为 `Uint8Array`，并在接收端用 `applyAwarenessUpdate` 应用。|
| Auth | `authProtocol.readAuthMessage` | 无需额外编码（由服务端生成），客户端仅需传入 `Y.doc` 与回调。| 仅在需要鉴权的环境使用，服务端可回复 messageAuth 消息。|
| Query Awareness | 复用 Awareness 编码 | `awarenessProtocol.encodeAwarenessUpdate` | 用于服务器主动拉取当前 awareness，行为和 `messageAwareness` 一致但回复类型仍为 `1`。|

```ts
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const encodeSyncMessage = (doc: Y.Doc) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

const decodeMessage = (buf: Uint8Array) => {
  const decoder = decoding.createDecoder(buf)
  const msgType = decoding.readVarUint(decoder)
  switch (msgType) {
    case 0:
      syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, provider)
      break
    case 1:
      awarenessProtocol.applyAwarenessUpdate(provider.awareness, decoding.readVarUint8Array(decoder), provider)
      break
    // 其他类型类似
  }
}
```

每条消息编码完成后，需附加通用 metadata（`roomId`/`senderId`/`docId`/`version`），并按统一格式打包为 Kafka payload。解码端首先解析 metadata，再进入 `messageHandlers`，保持和原始 `messageSync`、`messageAwareness` 等的一致逻辑，确保 `provider.synced`、`awareness`、`status` 等值同步变化。

## ProtocolMessageCodec 模块

通过 `src/codec` 目录的模块化实现（`types.ts`、`handlers`、`index.ts`）统一处理 y-websocket 消息，并提供 Kafka 载荷的打包/解包。  

1. **Types**：`ProtocolMessageMetadata` 扩展到 `subdocId`/`note`，`ProtocolCodecContext` 维持 `doc/awareness/synced` 状态。  
2. **Handlers**：`handlers/sync.ts`、`handlers/awareness.ts`、`handlers/auth.ts`、`handlers/queryAwareness.ts` 直接复用 `syncProtocol`/`awarenessProtocol`/`authProtocol`，保持与官方的 message 逻辑一致。  
3. **Index**：`decodeMessage` 按 type 路由、`encodeSyncStep1/2`/`encodeAwareness`/`encodePermissionDenied` 层层封装，`createMetadata` + `encodeKafkaEnvelope` 把 metadata + base64 payload 按 JSON 写入 Kafka，`decodeKafkaEnvelope` 可还原。  

旧版 `src/protocolMessageCodec.ts` 已删除，README 中的示例、Kafka metadata 说明与 Hocuspocus hook 对齐，建议使用新模块替代老文件。

- `decodeMessage(context, buffer, emitSynced)`：解析 y-websocket 二进制并在 `context.doc`/`context.awareness` 上应用。本文中所说的 `SyncStep`、`Awareness` 均在此处理。返回值为需要回馈服务器的 payload（如 SyncStep2），或 `null`。
- `encodeSyncStep1(doc)` / `encodeSyncStep2(doc, stateVector)`：与 `syncProtocol.writeSyncStep{1|2}` 保持一致，便于发送同步请求与应答。
- `encodeUpdate(update)`：重用 `syncProtocol.writeUpdate` 直接转发 Yjs update（可用于 `messageYjsUpdate` 通道）。
- `encodeAwareness(awareness, clientIds?)` / `encodeQueryAwareness(awareness)`：封装 `messageAwareness` / `messageQueryAwareness`，生成 awareness payload 供广播。
- `encodePermissionDenied(reason)`：封装 `messageAuth`，用于服务端在鉴权失败时返回。

另外导出的 `ProtocolMessageType`、`ProtocolMetadata`、`ProtocolCodecContext` 便于上层构建 `ProtocolProvider`、Kafka 生产者 / 消费者或任何需要对接 y-websocket 的连接层。

示例：

```ts
import { ProtocolCodecContext, encodeSyncStep1 } from './protocolMessageCodec'

const providerContext: ProtocolCodecContext = {
  doc,
  awareness,
  synced: false,
  setSynced: (value) => { synced = value },
  permissionDeniedHandler: (reason) => console.warn('auth failed', reason)
}

ws.onmessage = (event) => {
  const reply = decodeMessage(providerContext, new Uint8Array(event.data), true)
  if (reply) {
    ws.send(reply)
  }
}

const syncRequest = encodeSyncStep1(doc)
ws.send(syncRequest)
```

## 持久化与数据库

1. **快照策略**
   - 定期将 `Y.Doc` 二进制快照写入数据库（例如 PostgreSQL、Mongo）。
   - 可通过 Kafka 事件触发（例如每 N 条 update 触发一次 `snapshot` 事件）。

2. **增量持久化**
   - 可选地将 update 记录写入 append-only 表（audit log）。
   - 利用 Kafka 消费顺序确保持久化与 Kafka 同步一致。

3. **恢复逻辑**
   - 连接启动时尝试从数据库加载最近快照 + delta，恢复 `Y.Doc` 状态。
   - 如果 Kafka 记录可以回放，可以结合 `offset` 恢复至最新。

## 下一步建议

1. 定义 `ProtocolConnection` 接口并完成 Kafka 适配层。
2. 设计 `ProtocolProvider` 类（类似 WebsocketProvider）供客户端使用。
3. 编写测试确保 Kafka 消费与 `Y.Doc` 更新顺序一致。
4. 补充数据库适配层（例如 Redis/SQL 快照与持久 log）。
