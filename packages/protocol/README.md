# @y-kafka-collabation-server/protocol

本包定义了主 README 中提到的唯一事件载体 **ProtocolMessage** 及其编解码流程：Provider、Runtime、Transport、Persistence 都通过它共享同一 metadata 与 Kafka envelope 约定。目标与职责：

1. 抽象 `roomId/docId/subdocId/channel/version/senderId/timestamp/payload` 的 metadata，并提供 `encodeKafkaEnvelope`/`decodeKafkaEnvelope` 以便任意进程落盘/回放。
2. 提供 Yjs Sync/Awareness/Control 的二进制编解码（与 y-websocket 契约一致），供 Provider（上行）、Runtime（下行）和 Persistence（回放）直接复用。
3. 支撑 Runtime 中的 TopicResolver 与 RoomRoadMap：Protocol 负责定义 metadata 字段，真正的 topic 选择与连接路由由 Runtime 实现，不在本包内持有状态。
4. 为 Persistence/无状态服务器提供一致的 version/offset 载体，使主 README 中的“上行 ACK / 下行广播 / 初始化恢复”链路可以依靠 metadata 完成。

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

## 无状态消息流

为了让每台 Socket.IO 实例都能在无状态前提下保持完全一致的消息流，设计如下：

1. **单向入站**：客户端发出的 Sync/Awareness/Control 消息只会被当前 Socket.IO 服务器转发到 Kafka（`produce`），不再在本地应用或立即广播。
2. **统一消费**：所有实例订阅 `room` 对应的 Kafka topic，在消费后通过 `ProtocolMessageCodec.decodeMessage` 应用到本地 `Y.Doc`/`Awareness`，再基于 `senderId`、`roomId/docId` 将消息推送给该实例下所有属于同一 room/subdoc 的 Socket.IO 连接。
3. **去重策略**：消息 metadata 里带有 `senderId`，客户端可以根据该值判断是否是自己发出的重播，从而避免重复应用。
4. **降级兼容**：当 Socket.IO 被降级成 HTTP（如 long-poll 或 SSE）时，仅保留 transport 层不带状态；消息的路由仍依赖 Kafka 的 consumer group，只是在 HTTP 请求/响应中轮询或推送 Kafka 消息。

## 回放与冷启动

1. **Kafka 作为唯一来源**：连接启动或重新加入集群的实例会从 Kafka 开始消费 `yjs-doc-{room}` topic。Kafka 保证每个 partition 的顺序，实例按照 offset 顺序执行 `decodeMessage`，即使是刚加入的节点也能追上无状态集群的最新状态。
2. **CRDT 差分恢复**：Yjs 通过 `state vector` 与 `update` 机制管理缺失部分。消费者在收到 update 后会在本地 `Y.Doc` 中合并，并通过 `syncProtocol.readSyncMessage` 检测是否还需要 `SyncStep2`。如果本地缺少某些 update，服务端/其他实例可以根据 `state vector` 生成差值并继续发送（例如通过 `encodeSyncStep2`）。
   - 当客户端 provider 为了节省性能而中断连接（例如低频 reconnect）时，它在重新连接后会先请求 SyncStep1/2。服务端/Kafka 消费者会根据 provider 上报的 state vector 判断缺失区间：若有差异，会用 `syncProtocol.writeSyncStep2` 生成补全 update，发送至 Kafka，再由 Kafka 消费循环下发给该 provider 所在的实例，由其通过 Socket.IO 转给客户端。
3. **Metadata**：每条 Kafka 消息都会附带 `roomId` 与 `docId`，两者均为必填。`roomId` 用于 Kafka topic 路由，`docId` 用于标识具体 `Y.Doc` 实例。

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
| Sync | `syncProtocol.readSyncMessage` / `syncProtocol.writeSyncStep1` | `encoding.writeVarUint` / `encoding.toUint8Array` | 先写入消息类型 `0`，然后委托 syncProtocol 生成/解析 `SyncStep1/2` 的二进制 payload。 |
| Awareness | `awarenessProtocol.encodeAwarenessUpdate` / `applyAwarenessUpdate` | `encoding.writeVarUint8Array` | 将 awareness state 编码为 `Uint8Array`，并在接收端用 `applyAwarenessUpdate` 应用。 |
| Auth | `authProtocol.readAuthMessage` | 无需额外编码（由服务端生成），客户端仅需传入 `Y.doc` 与回调。 | 仅在需要鉴权的环境使用，服务端可回复 messageAuth 消息。 |
| Query Awareness | 复用 Awareness 编码 | `awarenessProtocol.encodeAwarenessUpdate` | 用于服务器主动拉取当前 awareness，行为和 `messageAwareness` 一致但回复类型仍为 `1`。 |

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

1. **Types**：`ProtocolMessageMetadata` 扩展到 `subdocId`/`note`，`ProtocolCodecContext` 维持 `doc/awareness/synced` 状态。Metadata 里同时保留 `roomId` 与 `docId`，运行时以 `roomId` 为 Kafka topic 的主键，`docId` 用于理清 `Y.Doc` 实例唯一性。  
2. **Handlers**：`handlers/sync.ts`、`handlers/awareness.ts`、`handlers/auth.ts`、`handlers/queryAwareness.ts` 直接复用 `syncProtocol`/`awarenessProtocol`/`authProtocol`，保持与官方的 message 逻辑一致。  
3. **Index**：`decodeMessage` 按 type 路由、`encodeSyncStep1/2`/`encodeAwareness`/`encodePermissionDenied` 层层封装，`createMetadata` + `encodeKafkaEnvelope` 把 metadata + payload 按 JSON 写入 Kafka，`decodeKafkaEnvelope` 负责同时封装与还原。|

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

## 代码结构概览

- `src/types.ts`：定义与 y-websocket 保持一致的 `ProtocolMessageType`、metadata、`ProtocolCodecContext` 以及 handler 签名，供上层 provider/consumer 复用。
- `src/index.ts`：核心编解码逻辑，包含 `decodeMessage`、`encodeSyncStep1|2|update|awareness` 以及 Kafka 信封的 `encodeKafkaEnvelope`/`decodeKafkaEnvelope` 实现。
- `src/handlers/*`：`sync`、`awareness`、`auth`、`queryAwareness` 四个 handler 拆成模块，分别复用 `@y/protocols` 的官方实现，并在 `ProtocolCodecContext` 上触发状态更新与 `permissionDenied`。
- `src/__tests__/codec.test.ts`：使用 Vitest 验证 codec 编解码流程，确保 metadata + payload 的 round-trip 与 `ProtocolMessageType` 的处理顺序。

## 核心 API 快速参考

### 解码 / 编码

```ts
const reply = decodeMessage(context, incomingPayload, true);
```

- `decodeMessage`：将 Kafka/Base64 payload 反序列化为 `ProtocolMessageType` 并调用对应 handler；如果 handler 需要返回 SyncStep2 等回复，它会把 encoder 内容作为 `Uint8Array` 返回，上层 provider 负责重新发送。
- `encodeSyncStep1` / `encodeSyncStep2` / `encodeUpdate`：保持 y-websocket 的格式编码同步信息，便于直接复用 `syncProtocol`.
- `encodeAwareness` / `encodeQueryAwareness`：将 Awareness 状态序列化为 `messageAwareness` 格式；`encodeQueryAwareness` 复用 Awareness 编码即可。
- `encodePermissionDenied`：在鉴权失败时告知客户端 `messageAuth`。

### Kafka Envelope

```ts
const envelope = encodeKafkaEnvelope(payload, metadata);
const { payload, metadata } = decodeKafkaEnvelope(envelope);
```

- `encodeKafkaEnvelope`：把 metadata 序列化为 JSON，再拼接 payload，前 5 字节包含格式 + metadata 长度，方便 Kafka 消息直接落盘。
- `decodeKafkaEnvelope`：校验长度、格式，解析 metadata 与原始 Yjs 二进制，可抛出错误供消费层记录。
- `createMetadata`：辅助生成包含 `roomId/docId/subdocId/senderId/timestamp` 的 metadata，保持 provider 与 transport 之间一致性。

## 集成指南

1. 在 Kafka 生产者/Socket 处理链中注入 `ProtocolCodecAdapter`（`encodeKafkaEnvelope`/`decodeKafkaEnvelope`），以便统一落盘与恢复。
2. 上下游使用 `ProtocolCodecContext`：`doc`/`awareness` 实例需由 `@y/y` 与 `@y/protocols/awareness` 创建，`setSynced` 由调用方实现以便 `sync` 完成后触发 `synced` 事件。
3. 如果要复用 `protocol` package 提供的 codec，可以直接 `import { decodeMessage, encodeAwareness } from '@y-kafka-collabation-server/protocol';` 结合 NestJS provider 注入。

## 运行与测试

- `npm run lint`：通过 `eslint`（`@y-kafka-collabation-server/eslint-config`）检查。
- `npm run check-types` / `npm run build`：`tsc -b` 生成 `dist`，供其他 workspace package 引用。
- `npm run test`：Vitest 运行 `src/__tests__/codec.test.ts`，确保 Yjs 编解码与 metadata round-trip。

## 依赖与兼容

- 核心依赖：`@y/y`、`@y/protocols`、`lib0`，保持与 upstream yjs 版本同步以便 二进制兼容。
- 构建输出位于 `dist/*.js`，package exports 已按路径映射，确保 `transport`/`persistence` 能直接引入。

## 术语与一致性约定

- 所有 metadata 必须包含 `roomId`（Topic）与 `docId`（Document），用于在 Kafka consumer 端定位房间与文档。
- `senderId` 通常取 `doc.clientID`，用于去重 `awareness` 与 `doc` 消息的自回放。
- `version` 字段由上层持有（如 persistence coordinator），用于快照与 delta 的顺序。
