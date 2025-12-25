# @y-kafka-collabation-server/provider

## 1. 目标

`provider` 旨在为前端客户端提供一个类 `WebsocketProvider` 的抽象，它封装了与 `@y-kafka-collabation-server/protocol` 的所有交互：Kafka Envelope 的收发、metadata 构建、`Y.Doc` 与 awareness 的同步状态、事件广播等。集成时，只需传入文档上下文和 WebSocket 端点，其余行为与 y-websocket 保持一致，但切换成我们定义的 Kafka-friendly 协议。

## 2. 核心能力

| 能力 | 描述 |
| --- | --- |
| `ProtocolProvider` 类 | 接入 `reads / writes` `ProtocolCodecContext`，自动调用 `decodeMessage`、`encodeSyncStep1|update|awareness` 和 `encodeKafkaEnvelope`/`decodeKafkaEnvelope`。 |
| metadata 定制 | 支持 `roomId/docId/subdocId/senderId/version/timestamp`、`metadataCustomizer` 让使用方可注入业务字段。 |
| 连接管理 | 自动重连、状态事件（`status`/`sync`/`permission-denied`/`awareness`/`error`）与 `autoConnect`、`reconnectInterval` 等配置。 |
| Awareness + update forwarding | `doc.update` 与 awareness change 都会被编码后推送；`permissionDeniedHandler` 发生时会触发 `permission-denied` 事件并断开。 |

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

## 4. 事件与生命周期

| 事件 | 触发时机 | 备注 |
| --- | --- | --- |
| `status` | 连接状态变化 | `'connected'` / `'connecting'` / `'syncing'` / `'denied'` / `'disconnected'`。 |
| `sync` | `SyncStep2` 命令完成，`setSynced(true)` 被调用 | 同步完成后自动触发，可用于 UI 解锁。 |
| `awareness` | 本地 awareness state 有变更且本实例与变更相关 | 自动 encode 并发送 awareness update。 |
| `permission-denied` | 服务端返回 `messageAuth`（`encodePermissionDenied`） | 会停止连接，并抛出理由。 |
| `error` | WebSocket/解码失败等异常 | 可用于聚合日志或回退。 |

## 5. metadata 生成与自定义

`ProtocolProvider` 会先通过 `createMetadata(doc, roomId, subdocId)` 生成基础 fields，包含 `roomId`/`docId`/`senderId`/`timestamp`。在发送前可通过 `metadataCustomizer` 覆盖这些字段，例如附加 `version` 或业务 trace。

## 6. 消息流说明

1. `doc` 发生 `update`：`encodeUpdate` -> metadata -> `encodeKafkaEnvelope` -> `WebSocket.send`。  
2. awareness 变化（本实例关联）：`encodeAwareness` -> metadata -> `encodeKafkaEnvelope` -> `WebSocket.send`。  
3. 接收服务器消息：`decodeKafkaEnvelope` -> `decodeMessage`（自动 apply update/awareness）-> 若有回复（如 SyncStep2）则通过 `queueMessage` 发回。  
4. `decodeMessage` 中会调用 `setSynced`，触发 `sync` 事件并更新内部 `synced` 标志。  

## 7. 测试建议

1. 使用 `vitest` 创建 mock WebSocket (可用 simple event emitter) 来验证 `ProtocolProvider` 能否在 `SyncStep2` 返回时提交通信并设置 `synced`。  
2. 模拟 metadata-embedded `Kafka envelope` payload，断言 `decodeMessage` 正确调用 `encodeKafkaEnvelope` 并通过 `queueMessage` 发送 reply。  
3. 验证 `permissionDeniedHandler` 触发后 `permission-denied` 事件与 `status` 拒绝流。

## 8. 编辑器集成提示

如果你的编辑器（比如搭配 `y-prosemirror`）在每次进入/退出 subdoc 时都需要重新绑定 `Y.Doc`，建议在上层维护一个生命周期管理器：进入 subdoc 时初始化 `Y.Doc + ProtocolProvider`，离开时调用 `provider.destroy()`、`doc.destroy()`、清理监听。这样可以避免一个 provider 绑多个 subdoc 的状态混乱，也方便实现“块状编辑”里频繁创建/销毁的逻辑。  

这种管理不属于服务端职责，主要是给接入方一个提示；后续可以在编辑器集成仓库里补一个 demo（例如 y-prosemirror 绑定的典型用法）强调如何用 `metadataCustomizer` 或 `queueMessage` metadata 覆盖来保持 subdoc 路由一致。
