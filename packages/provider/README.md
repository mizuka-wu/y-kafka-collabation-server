# @y-kafka-collabation-server/provider

`@y-kafka-collabation-server/provider` 是主 README 中客户端侧的实现：它把本地 `Y.Doc`/Awareness 与 Runtime 的 Socket.IO 通道连接起来，生成统一的 `ProtocolMessage`（含 `roomId/docId/subdocId/channel/version/senderId/timestamp/payload`），并处理 Runtime 返回的 ACK/offset 与第三方广播。与 y-websocket 的使用方式保持一致，但所有消息都经过 Protocol 包装、TopicResolver 解析后的 Kafka 流。

## 1. 目标

1. 复刻 `WebsocketProvider` 的生命周期、事件与自动重连体验，让现有编辑器可以零改动迁移到 Kafka 架构。  
2. 为 Runtime 提供完整 metadata（`roomId/docId/subdocId/senderId/channel`），确保 TopicResolver 能正确解析 topic，RoomRoadMap 可基于 metadata 路由广播。  
3. 在 Runtime ACK 时接受 `(topic, partition, offset)`，并暴露 hook 让上层缓存最新 version/offset（用于后续重连）。  
4. 统一 encode/decode：所有 Sync/Awareness/Control 消息都通过 `@y-kafka-collabation-server/protocol` 提供的 codec 完成，保证端到端兼容。

## 2. 核心能力

| 能力 | 描述 |
| --- | --- |
| `ProtocolProvider` 类 | 维护 `ProtocolCodecContext`，自动调用 `encodeSyncStep1 / update / awareness`、`decodeMessage` 与 Kafka envelope，隐藏底层二进制细节。 |
| Metadata 生成 | 固定补全 `roomId/docId/subdocId/senderId/channel/timestamp`；通过 `metadataCustomizer` 可注入 `version`、trace 等自定义字段。 |
| Version/offset hook | `onAck` 事件返回 Runtime 写入 Kafka 后的 `(topic, partition, offset)`，方便客户端持久化最新 version。 |
| 连接管理 | 自动重连、`status`/`sync`/`awareness`/`permission-denied`/`error` 等事件；兼容 Socket.IO Engine.IO 降级。 |
| Awareness & update forwarding | `Y.Doc` `update` 与 awareness diff 会自动编码并发送；接收端调用 `decodeMessage` 后直接应用到本地 Doc。 |

## 3. 快速开始

```ts
import * as Y from '@y/y';
import { ProtocolProvider } from '@y-kafka-collabation-server/provider';

const doc = new Y.Doc();
const provider = new ProtocolProvider(doc, {
  url: 'wss://broker.example.com/protocol',
  roomId: 'room-42',
  autoConnect: true,
  reconnect: true,
});

provider.on('status', (status) => {
  console.log('provider status', status);
});

provider.on('sync', () => {
  console.log('document synced');
});

provider.on('awareness', (changes) => {
  console.log('awareness changed', changes);
});
```

## 4. 最小实现示例

如果只是想用 `ProtocolProvider` 实现一个简单的同步客户端，可以直接在一个页面里写：

```ts
import * as Y from '@y/y';
import { ProtocolProvider } from '@y-kafka-collabation-server/provider';

const doc = new Y.Doc();
const provider = new ProtocolProvider(doc, {
  url: 'wss://broker.example.com/protocol',
  roomId: 'room-42',
  autoConnect: true,
  reconnect: true,
});

doc.getArray('messages').observe(() => {
  console.log('doc changed', Y.encodeStateAsUpdate(doc));
});
```

这个例子里只要传入 `Y.Doc` 与 endpoint，`ProtocolProvider` 会自动建立 WebSocket、完成 SyncStep1、监听 `update`/`awareness` 并通过 Kafka envelope 转发，不需要额外手动打包 metadata。

## 5. 事件与生命周期

| 事件 | 触发时机 | 备注 |
| --- | --- | --- |
| `status` | 连接状态变化 | `'connected'` / `'connecting'` / `'syncing'` / `'denied'` / `'disconnected'`。 |
| `sync` | `SyncStep2` 命令完成，`setSynced(true)` 被调用 | 同步完成后自动触发，可用于 UI 解锁。 |
| `awareness` | 本地 awareness state 有变更且本实例与变更相关 | 自动 encode 并发送 awareness update。 |
| `permission-denied` | 服务端返回 `messageAuth`（`encodePermissionDenied`） | 会停止连接，并抛出理由。 |
| `error` | WebSocket/解码失败等异常 | 可用于聚合日志或回退。 |

## 6. ACK 与 version 同步

Runtime 在写入 Kafka 成功后会立刻通过 Socket.IO 返回 `(topic, partition, offset)`；`ProtocolProvider` 会触发 `onAck` / `provider.on('ack', handler)`，传入上述三元组以及当前 `roomId/docId/subdocId`。建议在回调内：

1. 把 offset 记录到本地存储/IndexedDB，供下次重连携带 `lastVersion`。  
2. 将 ack 信息与 UI 状态联动，例如在编辑器中提示“已保存”。  
3. 如果 Runtime 返回 `error` 或 ack 超时，可以在前端触发重连或降级逻辑。

## 7. metadata 生成与自定义

`ProtocolProvider` 会先通过 `createMetadata(doc, roomId, subdocId)` 生成基础 fields，包含 `roomId`/`docId`/`senderId`/`timestamp`。在发送前可通过 `metadataCustomizer` 覆盖这些字段，例如附加 `version` 或业务 trace。

## 8. 消息流说明

1. `doc` 发生 `update`：`encodeUpdate` -> metadata -> `encodeKafkaEnvelope` -> `WebSocket.send`。  
2. awareness 变化（本实例关联）：`encodeAwareness` -> metadata -> `encodeKafkaEnvelope` -> `WebSocket.send`。  
3. 接收服务器消息：`decodeKafkaEnvelope` -> `decodeMessage`（自动 apply update/awareness）-> 若有回复（如 SyncStep2）则通过 `queueMessage` 发回。  
4. `decodeMessage` 中会调用 `setSynced`，触发 `sync` 事件并更新内部 `synced` 标志。  

## 9. 测试建议

1. 使用 `vitest` 创建 mock WebSocket (可用 simple event emitter) 来验证 `ProtocolProvider` 能否在 `SyncStep2` 返回时提交通信并设置 `synced`。  
2. 模拟 metadata-embedded `Kafka envelope` payload，断言 `decodeMessage` 正确调用 `encodeKafkaEnvelope` 并通过 `queueMessage` 发送 reply。  
3. 验证 `permissionDeniedHandler` 触发后 `permission-denied` 事件与 `status` 拒绝流。

## 10. 编辑器集成提示

如果你的编辑器（比如搭配 `y-prosemirror`）在每次进入/退出 subdoc 时都需要重新绑定 `Y.Doc`，建议在上层维护一个生命周期管理器：进入 subdoc 时初始化 `Y.Doc + ProtocolProvider`，离开时调用 `provider.destroy()`、`doc.destroy()`、清理监听。这样可以避免一个 provider 绑多个 subdoc 的状态混乱，也方便实现“块状编辑”里频繁创建/销毁的逻辑。  

这种管理不属于服务端职责，主要是给接入方一个提示；后续可以在编辑器集成仓库里补一个 demo（例如 y-prosemirror 绑定的典型用法）强调如何用 `metadataCustomizer` 或 `queueMessage` metadata 覆盖来保持 subdoc 路由一致。
