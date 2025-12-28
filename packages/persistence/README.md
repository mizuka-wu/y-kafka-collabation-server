# @y-kafka-collabation-server/persistence

`persistence` 包负责将 Kafka 事件流落盘，聚焦于 `Y.Doc` 快照、update history、无 GC 历史导出和 object storage 归档，目标是为无状态 Kafka 消费者提供可重放、可审计的状态恢复能力。

## 目标与职责

1. 提供统一的 `PersistenceAdapter` 接口（见 `src/types.ts`），让不同存储实现（关系型、对象存储、对象式 key-value）都可以被 `PersistenceCoordinator` 调用。
2. 先写入 `DocumentSnapshot`（Y.Doc 二进制快照）再附带 `UpdateHistory`（audit log），以 `version`/`docId`+`subdocId` 形式提供顺序回放。
3. 为新节点/无状态实例提供 `loadLatestSnapshot` + `exportHistory` 流程，支持 `sinceVersion` 的增量补全。

## 目录结构

- `src/types.ts`：TypeORM 实体定义（`DocumentSnapshot`、`UpdateHistory`）、`PersistenceMetadata`、`PersistenceAdapter` 以及 `PersistenceDocId` 等基础类型。
- `src/adapter.ts`：`TypeOrmPersistenceAdapter`，负责将 `Y.Doc` binary 直接以 `VARBINARY` 形式存入 `document_snapshots`、`update_history` 表，并支持 `historyOnly`、`sinceVersion` 查询，避免额外 Base64 编码开销。
- `src/coordinator.ts`：`PersistenceCoordinator` 封装 adapter，提供 recover/persist/export 等常用 API，供上层 Kafka consumer/Kafka bus 直接注入。
- `src/integration.ts`：提供 `createPersistenceCoordinator` 与 `buildPersistenceProviders`，方便在 NestJS 中构建 `PERSISTENCE_COORDINATOR` provider。
- `README.md`：说明角色、使用建议与扩展方向。

## API 快速参考

```ts
const coordinator = createPersistenceCoordinator(dataSource)

await coordinator.persistUpdate(metadata, binary)
await coordinator.persistSnapshot(metadata, binary)

const snapshot = await coordinator.recoverSnapshot(docId, subdocId)
const history = await coordinator.exportHistory(docId, subdocId, sinceVersion)
```

核心依赖：`typeorm`、`reflect-metadata`、`mysql2`（可替换为任意 TypeORM 支持的 database），并将 `@y-kafka-collabation-server/protocol` metadata 作为前后端协作的统一 schema。

## 使用流程建议

1. 初始化阶段在 NestJS Module 中构造 `DataSource`（MySQL/PostgreSQL/Mongo）并调用 `createPersistenceCoordinator` 导出 `PERSISTENCE_COORDINATOR` provider。
2. Kafka consumer（或其他 bus）每次拉到 doc/awareness update 时：
   - 调用 `persistUpdate(metadata, binary, historyOnly)`，将 metadata（含 `docId`/`roomId`/`subdocId`/`version`）写入 `update_history`。
   - 根据策略（如每 50 条 update）再执行一次 `persistSnapshot`，更新 `document_snapshots` 中的 `storageLocation` 便于指向 MinIO/OSS。
3. 新节点或重连时，先执行 `recoverSnapshot` 加载最新 snapshot，随后 `exportHistory`（`sinceVersion` 传入此 snapshot 的 version）以 `SyncStep2` 补全剩余 delta。
4. 需要对外导出 `.ydoc` 历史时，可直接读取 `DocumentSnapshot.data`（原始二进制 Buffer）并上传 object storage，同时记录 `storageLocation` 便于追踪和合规。

## NestJS 集成要点

- 提供 `buildPersistenceProviders(dataSourceToken)`，可将 `PERSISTENCE_COORDINATOR` 注入至任何需要的 provider。
- `TypeOrmPersistenceAdapter` 通过 `DataSource.getRepository()` 拿到 `DocumentSnapshot`/`UpdateHistory`，任何自定义 adapter 也只需实现 `PersistenceAdapter` 即可替换。
- 推荐搭配 `KafkaConsumer` 以事件驱动方式调用 `persistUpdate`，可在 `onModuleInit` 中消费 Kafka topic 。

## 拓展方向

- 可以添加独立的 `SnapshotScheduler` 监听 Kafka timestamp，在指定间隔内强制 snapshot 并同步至对象存储。
- 可实现 `MinioStorageAdapter` / `S3StorageAdapter`，将 metadata 中的 `storageLocation` 关联到外部对象存储中的二进制文件，实现无 GC 的历史归档。
