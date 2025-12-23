# @y-kafka-collabation-server/persistence

`persistence` 包负责将 Kafka 事件流落盘，聚焦于 `Y.Doc` 快照、update history、无 GC 历史导出与 object storage 归档。核心能力包括：

1. **TypeORM 实体**：`DocumentSnapshot`（`docId`、`version`、`timestamp`、`storageLocation`、base64 `data`）和 `UpdateHistory`（记录每条操作的 `metadata`/`payload`，便于按版本导出）。
2. **PersistenceAdapter 接口**：定义 `loadLatestSnapshot`、`persistSnapshot`、`persistUpdate`、`exportHistory`，让 Kafka consumer 或 `bus` 通过 DI 注入不同落库实现。
3. **TypeOrmPersistenceAdapter**：把 `Y.Doc` binary 转 Base64、记录 snapshot/history、支持 `historyOnly` 参数和 `sinceVersion` 查询。

## 结构

- `src/types.ts`：TypeORM entity、metadata 定义及 `PersistenceAdapter` interface。
- `src/adapter.ts`：`TypeOrmPersistenceAdapter` 实现，封装 Base64 转换、snapshot/history 保持、history 查询逻辑。
- `README.md`：描述 persistence 的角色与使用指引。

## 使用建议

1. NestJS 初始化阶段连接 MySQL（或其它 TypeORM 支持的数据库），创建 `TypeOrmPersistenceAdapter` 并注入 Kafka consumer/`bus`。
2. Kafka 消费 `doc`/`awareness` 消息时调用 `persistUpdate`，必要时设置 `historyOnly` 只写 history；依据 `metadata.version` 每 N 次触发 `persistSnapshot` 生成基线 snapshot 并更新 `storageLocation`（指向 MinIO/OSS）。
3. 新节点/重连时先调用 `loadLatestSnapshot` 恢复到最近版本，再用 `exportHistory(sinceVersion)` 补全低于该版本的 Kafka delta，恢复至最新状态，类似 `SyncStep2` 补全机制。
4. 导出历史 `.ydoc` 文件时，直接读取 `DocumentSnapshot.data`（Base64）并上传 object storage，同时记录 `storageLocation` 以便追踪。

## 扩展方向

- 可以添加 `SnapshotScheduler` 订阅 Kafka timestamp，按周期生成最新 snapshot 并上传到 MinIO。
- 未来还可实现 `MinioStorageAdapter` 或 `S3StorageAdapter`，将 `storageLocation` 关联至对象存储中的 binary 文件，保持无 GC 的历史归档。
