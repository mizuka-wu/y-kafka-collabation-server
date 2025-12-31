# @y-kafka-collabation-server/transport

本包是 Runtime 的“传输适配层”，只做两件事：

1. **接收 Socket.IO 上行消息 → 写入 Kafka**：把 Provider/Runtime 已经封装好的 `ProtocolMessage`（payload + metadata）交给 `TopicResolver` 选 topic，再用 `@y-kafka-collabation-server/protocol` 的信封直接写入 Kafka；transport 本身不新增 metadata，只负责路由 + produce。
2. **消费 Kafka → 广播给当前实例的 sockets**：订阅 `sync/awareness/(可选 control)` topic，解包 metadata，利用 Runtime 注入的 `RoomRegistry` 找到 sockets 并透传给 Provider。

> 上层 Runtime 负责持久化、TopicResolver 实现、RoomRegistry 实现、Kafka 客户端实例等。transport 只提供需要复用的适配代码，确保与根 README 描述的“客户端 ↔ Runtime ↔ Kafka”流程一致。

---

## 职责对齐

| 链路 | transport 实际行为 | 依赖 |
| --- | --- | --- |
| 客户端 → Kafka | `createBusSocketHandlers().handleClientMessage` 读取 `ClientMessage`，照搬其中的 metadata/payload，借助 `TopicResolver` 选 topic，并调用 `protocolCodec.encodeKafkaEnvelope` → `kafkaProducer.produce`。transport 不补字段，只在缺失时返回错误。 | `TopicResolver`、`ProtocolCodecAdapter`、`KafkaProducer` |
| Kafka → 客户端 | `startKafkaConsumer` 读取 Kafka record，解包 envelope 得到 metadata + payload，根据 metadata 在 `RoomRegistry` 找 sockets，并组装成客户端期望的 `protocol-message`（包含 topic/partition/offset/metadata/payload）回推。 | `KafkaConsumer`、`RoomRegistry`、`ProtocolCodecAdapter` |

## 目录概览

- `src/types.ts`：集中定义 transport 需要的接口（Kafka producer/consumer、TopicResolver、RoomRegistry 等），便于 Runtime 以依赖注入的方式使用。
- `src/socketHandlers.ts`：实现 `createBusSocketHandlers`，给 Socket.IO 连接复用。
- `src/kafkaConsumer.ts`：实现 `startKafkaConsumer`，负责落地消费逻辑。
- `src/roomRegistry.ts`（若存在）：提供一个最简单的内存 `RoomRegistry` 示例，方便本地 demo；生产环境可替换为 Redis/自研版本。

## API

### `createBusSocketHandlers`

```ts
import { createBusSocketHandlers } from '@y-kafka-collabation-server/transport';

const handlers = createBusSocketHandlers({
  kafkaProducer,
  protocolCodec, // 直接传入 @y-kafka-collabation-server/protocol
  roomRegistry,  // Runtime 自己实现的 RoomRegistry
  topicResolver, // 负责把 metadata → topic
});

io.on('connection', (socket) => {
  handlers.handleConnection(socket, {
    roomId: assignment.roomId,
    docId: assignment.docId,
    subdocId: assignment.subdocId,
  });

  socket.on('protocol-message', async (message) => {
    await handlers.handleClientMessage(socket, message);
  });

  socket.on('disconnect', () => handlers.handleDisconnect(socket));
});
```

要点：

- `message.metadata` transport 只做最小校验（至少 `roomId/docId`），不负责补齐；若缺失请在 Runtime/Provider 层修复后再调用。
- `topicResolver` 只需实现 `resolveSyncTopic` / `resolveAwarenessTopic`（以及可选的 `resolveControlTopic`）；transport 不关心 topic 具体命名。
- transport 不做鉴权/速率控制，需要的话请在调用 `handleClientMessage` 前处理。

### `startKafkaConsumer`

```ts
import { startKafkaConsumer } from '@y-kafka-collabation-server/transport';

await startKafkaConsumer({
  kafkaConsumer,   // 任意兼容接口的 Kafka client
  protocolCodec,   // 仍然来自 protocol 包
  roomRegistry,    // 与 socket handler 共享
  topicResolver,   // 可携带 pattern，用于 subscribe
  onMessageEvent: 'protocol-message', // Provider 默认监听的事件名
  onMessageProcessed: async (metadata, payload) => {
    metrics.observe(metadata.docId, payload.length);
  },
});
```

行为说明：

1. 自动订阅 `topicResolver.syncTopicPattern ?? /yjs-sync-.+/` 与 `topicResolver.awarenessTopicPattern ?? /yjs-awareness-.+/`。
2. 每条消息都会 `decodeKafkaEnvelope`，解出 `metadata + messageType + payload`，并根据 `(docId, subdocId)` 找到 sockets。
3. 广播 payload 时不会做 Yjs 处理，Provider 复用 protocol 包直接调用 `decodeMessage`。
4. `onMessageProcessed` 可选，用于记指标或链路追踪。

## RoomRegistry 与 TopicResolver

- **RoomRegistry 接口**：  

  ```ts
  interface RoomRegistry {
    add(socket, assignment);
    remove(socket);
    getSockets(docId: string, subdocId?: string): Socket[];
  }
  ```  

  Runtime 可以实现内存、Redis、DB 等任意版本。transport 只依赖接口。

- **TopicResolver 接口**：  

  ```ts
  interface TopicResolver {
    resolveSyncTopic(metadata): string;
    resolveAwarenessTopic(metadata): string;
    resolveControlTopic?(metadata): string;
    syncTopicPattern?: RegExp;
    awarenessTopicPattern?: RegExp;
  }
  ```  

  你可以按租户 / room hash / slot 的方式返回 topic，同时提供匹配该策略的 `pattern` 供 consumer 订阅。

## 与 protocol 包的关系

- 统一使用 `protocol.encodeKafkaEnvelope` / `decodeKafkaEnvelope`（或更高阶 `encodeKafkaProtocolMessage` / `decodeKafkaProtocolMessage`），确保 Kafka 消息格式为  
  `[messageType:1][metadataLength:4][metadata JSON][payload（不含 type）]`。
- transport 永远不解析 Yjs payload，只负责搬运；真正的 Yjs handler 全在 protocol 包内定义，Provider/Runtime 共享一份实现。

## 集成流程（对应根 README）

1. Provider 发送 `protocol-message`（payload = 纯 y-websocket buffer，metadata = room/doc/subdoc/sender/channel）。  
2. Runtime 通过 `createBusSocketHandlers` 将消息写入 Kafka，并在写入成功后（在 Runtime 层）返回 `(topic, partition, offset)` 给发起方。  
3. `startKafkaConsumer` 消费 Kafka、查 `RoomRegistry`、把原始 payload + metadata 发给所有本机 sockets；Provider 再用 protocol 包解析并更新本地 Y.Doc/Awareness。  
4. 需要持久化或控制命令时，只需在 TopicResolver 中加入对应的 topic/protocol channel，transport 仍然保持透明。

## TODO / 扩展方向

- 抽象出错误回调，让 Runtime 可以自定义 `protocol:error` 事件格式。  
- 在 `startKafkaConsumer` 中暴露 hook，便于把 Kafka offset 自动 ACK 回 Provider。

---

进一步的限流、鉴权、日志采集均由 Runtime 层负责，transport 不涉入这些流程。
