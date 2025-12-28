# Collaboration Playbook

本文档汇总了协同服务器（Yjs + Kafka）在开发、联调及排查阶段的关键信息，便于与 `docs/ARCHITECTURE.md` 搭配阅读。

## 1. 背景

- **目标**：利用 Kafka 作为 Yjs 协同的唯一总线，统一 doc/awareness/control 消息流，通过 transport/provider/persistence 组件协同实现多人实时编辑。
- **核心特点**：
  1. Socket.IO 只负责事件收发，状态通过 Kafka 各 topic 串联；
  2. `ProtocolMessageMetadata`（roomId/docId/subdocId/version/senderId/timestamp）是消息路由与持久化的唯一依据；
  3. HTTP 降级、持久化回放、强同步都依赖同一套 envelope 编解码。

## 2. 快速检查清单

| 项目 | 目的 | 验证方式 |
| --- | --- | --- |
| 元数据完整性 | 保证 Kafka 消费端可路由 | 客户端 log + server Gateway 日志对比 metadata 字段 |
| Kafka 生产/消费 | 确认消息进出 topic | `kafka-console-consumer`/`kafka-consumer-groups` 查看 offset，与 server log 对照 |
| RoomRegistry 广播 | 确认 socket 分配正确 | Server log 记录 `roomId/subdocId` 下 socket 数量 |
| 持久化 | 验证 snapshot/history 顺序 | 查询数据库 version，匹配 `update_history` 递增 |
| 降级链路 | 断网/HTTP fallback 是否可用 | Demo 断开 WebSocket，观察 HTTP publish + sync-request 行为 |

## 3. 联调步骤

1. **环境准备**
   - 启动 Kafka、MySQL，并在根目录执行 `pnpm install`。
   - 运行 `pnpm --filter @y-kafka-collabation-server/server dev` 与 `pnpm --filter @y-kafka-collabation-server/demo dev`。
2. **单客户端验证**
   - Demo 加载文档时调用 `GET /collab/doc/:docId`，确认 snapshot+updates 返回正常；
   - 编辑器触发 `Y.doc.update`，观察 server Kafka producer 日志与 `/collab/status` 计数。
3. **多客户端协同**
   - 第二个 demo 通过相同 `docId` 加入，发送 `sync-request`；
   - 双端交错编辑，确认 version 线性递增、延迟在预期范围（<200ms）。
4. **降级场景**
   - 模拟 WebSocket 中断，检查客户端是否切换 HTTP publish；
   - 恢复连接后确认 `sync-request` 能回放缺失更新。
5. **持久化回放**
   - 手动调用 `POST /collab/persist` 保存 snapshot；
   - 清空客户端状态，仅依赖 `GET /collab/doc/:docId` + Kafka 广播恢复。

## 4. 日志与观测指标

| 组件 | 指标/日志 | 说明 |
| --- | --- | --- |
| Gateway | `socket.id`, `docId`, `channel`, `metadata.version` | envelope 解码失败时需记录 payload 大小与错误栈 |
| Kafka Producer | `topic`, `partition`, `offset`, `byteLength` | 观察生产耗时，排查拥塞 |
| Kafka Consumer | `roomId/subdocId`, socket 命中数 | 确认广播覆盖所有连接 |
| Persistence | `docId`, `version`, `history rows` | 发现 version 回退需报警 |
| Demo 客户端 | 本地 `version`, `latency`, `stateVector` | 对齐服务器 `/collab/messages` 输出以排查差异 |

## 5. 常见问题排查

1. **客户端无法收到更新**：
   - 检查 `RoomRegistry` 是否存在该 socket；
   - 观察 Kafka consumer 是否获取到对应 `roomId` 的消息；
   - 若 metadata 缺失 `roomId`/`docId`，需修复客户端或 Gateway。
2. **版本跳号或冲突**：
   - 确认客户端是否递增 `metadata.version`；
   - 通过 `/collab/messages` 导出 envelope，与客户端本地版本对比。
3. **HTTP 降级后状态不一致**：
   - 确保 `GET /collab/doc/:docId` 聚合了 Kafka 增量；
   - 检查 `aggregateKafkaUpdates` 是否启用。
4. **持久化缺失记录**：
   - 查看 `recordHistory` 是否拒绝了 metadata 不完整的消息；
   - 校验数据库 version 顺序与 Kafka offset 是否一致。

## 6. 后续扩展

- 接入 `TopicResolver` 自定义租户隔离策略；
- 将 `RoomRegistry` 替换为 Redis 方案以支持多实例共享状态；
- 增加 `/collab/messages` 调试接口返回 metadata 供 demo 客户端可视化。

> 若需详细协议与实现说明，请参考 `docs/ARCHITECTURE.md` 第 2、3、8 章，或各 packages README。
