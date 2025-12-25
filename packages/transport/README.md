# @y-kafka-collabation-server/transport

`transport` 包负责承接客户端的 Socket.IO 连接与 Kafka 消息流，肩负两项职责：一是把客户端发来的 Yjs payload 编码后 `produce` 到 Kafka，二是消费 Kafka topic、解码、按 room/subdoc 路由后广播给当前连接的 sockets。

## 设计理念

1. **完全无状态**：业务状态由 Kafka 消息流串联，Socket.IO 仅负责转发与事件通知，任何实例都可以挂入 consumer group 并基于 metadata 恢复路由信息。
2. **协议解耦**：transport 仅关心 `ProtocolMessageMetadata` 与 encode/decode，实际的 Yjs 处理由 `@y-kafka-collabation-server/protocol` 提供，保持与 websocket 版一致。
3. **可扩展的房间感知**：每条消息都携带 `roomId/docId/subdocId`，transport 通过 `RoomRegistry` 维护 socket ↔ room 的映射，支持按 subdoc 精准广播。

## 核心组件

- `src/types.ts`：定义 `BusClientMessage`（携带 payload + metadata）、`KafkaMessage`、`RoomRegistry`、`CreateTransportSocketHandlersDeps`、`StartKafkaConsumerDeps` 等接口，用于解耦实际实现。
- `src/socketHandlers.ts`：`createBusSocketHandlers` 生成 `handleConnection`/`handleClientMessage`/`handleDisconnect` 三个 hook，详细见返回逻辑（emit error、topic resolve、Kafka produce）。
- `src/kafkaConsumer.ts`：`startKafkaConsumer` 订阅 doc/awareness topic，循环消费 `eachMessage`，调用 `protocolCodec.decodeKafkaEnvelope` 后按 `roomId`/`subdocId` 从 `RoomRegistry` 获取 sockets 并广播。
- `src/roomRegistry.ts`：`DefaultRoomRegistry` 维护 socket assignment Map + 索引，支持按 room/subdoc 查询与自动 cleanup。

## API 快速参考

### 创建 Socket.IO handler

```ts
const handlers = createBusSocketHandlers({
  roomRegistry,
  kafkaProducer,
  protocolCodec,
  topicResolver,
});

io.on('connection', (socket) => {
  const assignment = { roomId: 'room-42', subdocId: 'doc-A' };
  handlers.handleConnection(socket, assignment);
  socket.on('protocol-message', async (message) => {
    await handlers.handleClientMessage(socket, message);
  });
  socket.on('disconnect', () => handlers.handleDisconnect(socket));
});
```

- `handleClientMessage` 会补 `roomId`、解析 `message.channel` 决定 topic（见 `resolveTopic`），将 payload 转 `Uint8Array`，再通过 `protocolCodec.encodeKafkaEnvelope` 发给 `kafkaProducer`。
- 请求发送失败或 metadata 缺失时会 `socket.emit('protocol:error')`，上层可以根据 `reason` 判断是否需要重连/断开。

### 启动 Kafka 消费

```ts
await startKafkaConsumer({
  kafkaConsumer,
  roomRegistry,
  protocolCodec,
  topicResolver,
  onMessageEvent: 'protocol-message',
});
```

- 会订阅 `topicResolver.docTopicPattern ?? 'yjs-doc-*'` 与 `awarenessTopicPattern ?? 'yjs-awareness-*'`，确保带 `roomId` 的 payload 收到时广播给当前 `RoomRegistry` 缓存的 sockets。
- 每条消息广播时会附带 `topic/partition/offset/metadata/payload`，便于客户端回放 UI 级别的调试信息。

## 使用建议

1. **NestJS 集成**
   - 在 Module 中提供 `KafkaProducer`/`KafkaConsumer` 实例（如 `@nestjs/microservices` 的 Kafka client）并注入 `ProtocolCodecAdapter`。
   - Gateway 在 `handleConnection` 调用 `createBusSocketHandlers`，并在 `onModuleInit` 时启动 `startKafkaConsumer`。
2. **并发控制**
   - 只保留 Kafka consumer 位点即可实现幂等；Redis/Cache 不再持久 socket 状态。
   - `RoomRegistry` 默认仅存在内存索引，若想跨实例同步可以继承并引入 shared storage（例如 Redis pub/sub 触发 remove/add）。
3. **Topic 策略**
   - `topicResolver` 提供 `resolveDocTopic`/`resolveAwarenessTopic`/`resolveControlTopic` 以及可选 `docTopicPattern`/`awarenessTopicPattern`，用于自定义集群&租户的 topic 命名。
   - 默认 `yjs-doc-{room}` 与 `yjs-awareness-{room}`，可通过 `roomId` 做多 doc 分区。

## 事件流说明

1. 客户端发送 `protocol-message`：transport 通过 handler 提取 metadata，保证 `roomId` 先优先于 `docId`，再把消息发往 `topicResolver.resolve*` 对应 topic。
2. Kafka 消费：`startKafkaConsumer` 解码 Kafka envelope，校验 metadata，取 `roomId || docId` 找到 sockets，再通过 `socket.emit(onMessageEvent, {...})` 送回客户端。
3. Disconnect：handler `handleDisconnect` 只清理 `RoomRegistry`，不依赖 Kafka；如需要广播离线事件可在 `roomRegistry` 扩展中加入 `onRemove` hook。

## 可观察性和降级

- 每次 `decodeKafkaEnvelope` 异常都会 `console.error('Invalid Kafka envelope', error)`，建议替换为项目统一的 logger 以便监控。
- 拓展 `onMessageProcessed` 回调（见 `StartKafkaConsumerDeps`）可以在消息广播后记录 metrics（latency、version gap）。
- 在 HTTP 降级场景，复用 `RoomRegistry.getSockets`，再由 controller 轮询 `kafkaConsumer` 或长轮询 `onMessageProcessed` 数据即可，不必修改 Kafka handshake。

## 拓展点

- **连接与 Kafka 订阅策略**
  - 所有 Socket.IO 实例都可以使用同一组 topic pattern（如 `yjs-doc-*`/`yjs-awareness-*`）订阅，Kafka consumer group 会自动在实例之间分配 partition，避免每台服务器都处理相同消息，从而不会引发“消息风暴”。
  - `startKafkaConsumer` 只需在每台实例启动一次，不需要 per-room subscribe；metadata 里的 `roomId/docId/subdocId` 用于在 `RoomRegistry` 里查找本实例实际持有的 sockets，再决定是否发射，避免无关的广播与判断。
  - 若希望限制每台实例负责的 room，可以自定义 `TopicResolver` 的 pattern/策略，例如将 topic 按租户、cluster 或 `roomId hash` 映射到不同的 consumer group，或扩展 `RoomRegistry` 让多个实例协同管理同一 room 的 sockets。
  - 通过 `metadata.senderId` 与 `version` 可以过滤自回放与重复消息，配合 protobuf/JSON metadata 保持连接层幂等，防止 Socket.IO loop-back。

- 支持 `topicResolver.resolveControlTopic`，就可接入 `control` channel，实现强制同步、snapshot/validate 等命令。
- 可实现自定义 `RoomRegistry`（如 `RedisRoomRegistry`）以支持跨进程 socket 追踪，或添加 `assignment.subdocId` 记录以供 `startKafkaConsumer` 精准过滤。
- 若要在 transport 增加认证、限流或容错，可以在 `handleClientMessage` 上层包装一层 middleware，避免污染 core handler 逻辑。
