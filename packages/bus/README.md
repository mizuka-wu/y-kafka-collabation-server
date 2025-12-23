# @y-kafka-collabation-server/bus

`bus` 包封装了 Socket.IO 与 Kafka 之间的消息流：对外负责处理客户端的 Socket.IO 连接/事件，对内负责把 Yjs payload 交给 Kafka，并且在消费到 Kafka 事件后把消息广播给当前连接的客户端。

## 设计目标

1. **完全无状态**：Socket.IO 仅负责输入/输出消息，所有业务状态来自 Kafka 事件流；服务节点只需根据 metadata 将消息路由到相应 room/subdoc。
2. **可运行在 NestJS 中**：依赖注入 Kafka producer/consumer 与 Protocol codec，并向外暴露 Socket.IO handler 供 NestJS Gateway 调用。
3. **可扩展的消费策略**：Kafka 的消费可以按 room 订阅、按 subdoc 重新路由，并通过 `roomRegistry` 维护 socket ↔ room 的映射。

## 暴露接口

1. `createBusSocketHandlers(deps)`：接受 `{ roomRegistry, kafkaProducer, protocolCodec, topicResolver }`，返回 Socket.IO `connection`/`message`/`disconnect` 需要的处理函数，让 Gateway 只需在 `connection` 事件里绑定即可。
2. `startKafkaConsumer(deps)`：接受 `{ kafkaConsumer, roomRegistry, protocolCodec, topicResolver }`，负责订阅 Kafka topic 并在 `eachMessage` 中解码、校验 metadata，然后广播给 registry 中当前在 room/subdoc 的 sockets。
3. `RoomRegistry`：辅助类用于记录 socket ↔ room/subdoc 的映射，提供 `getSockets(roomId, subdocId?)`、`add(socket, room)`、`remove(socket)` 等方法。

## 使用建议

1. 在 NestJS 的 Module 里注入 Kafka producer/consumer（例如使用 `@nestjs/microservices` 的 Kafka client）。
2. 导入 `@y-kafka-collabation-server/protocol` 的 codec，利用 `encodeKafkaEnvelope`/`decodeKafkaEnvelope` 处理 payload。
3. 在 Gateway 的 `handleConnection` 里调用 `createBusSocketHandlers` 返回的处理函数，把 `socket`、`room` 等信息传给 handler。
4. `startKafkaConsumer` 可以在 NestJS module 的 `onModuleInit` 中启动，以确保 consumer group 与 Kafka topic 准备好。

## 拓展点

- 支持 HTTP 降级（poll/SSE）时可复用 `RoomRegistry` 的 `getSockets`，自行实现轮询接口而无需改动 Kafka 消费逻辑。
- `topicResolver` 允许覆盖默认 `yjs-doc-{room}` 命名，便于接入多个 Kafka 集群或多租户场景。
