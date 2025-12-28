# @y-kafka-collabation-server/server

## Overview

`apps/server` 现在是用于演示 Kafka + MySQL 协同与 `ProtocolProvider` 协作的基础服务。它通过 `ServerCollabService` 提供简化的 Kafka topic、MySQL snapshot 存储接口，并允许 `apps/demo` 中的 `ProtocolProvider` 客户端通过 REST API 推送数据。

## 运行

1. 在根目录先安装依赖：`pnpm install`。
2. 在 server 目录运行开发服务：`pnpm --filter @y-kafka-collabation-server/server dev`。

服务默认监听 [http://localhost:3000](http://localhost:3000)。

## API 文档 (Swagger)

服务集成了 Swagger UI，启动后访问 [http://localhost:3000/api](http://localhost:3000/api) 即可查看完整的 API 文档、Schema 定义并进行在线调试。

## 提供的 API

| 路径 | 方法 | 描述 |
| --- | --- | --- |
| `/collab/status` | GET | 返回当前已知文档的 Kafka 消息数和最新 MySQL snapshot。 |
| `/collab/doc/:docId` | GET | 获取文档完整状态（最新快照 + 近期更新），用于**纯阅读态**或**降级初始化**。 |
| `/collab/publish` | POST | 接收 `PublishUpdateDto`，将内容写入 Kafka topic。可用于**降级写**。 |
| `/collab/persist` | POST | 接收 `PersistSnapshotDto`，将快照写入模拟 MySQL。 |
| （无 `/collab/messages`） | | 当前版本暂未提供直接拉取 Kafka 消息历史的接口。 |

### 请求体示例

#### Get Document State (`/collab/doc/:docId`)

- Query：`subdocId`（可选）用于获取子文档快照。
- Response：

```json
{
  "docId": "my-document-guid",
  "subdocId": "optional-subdoc",
  "snapshot": "base64-encoded-snapshot-or-null",
  "updates": [
    "base64-encoded-update-1",
    "base64-encoded-update-2"
  ],
  "_debug": {
    "kafkaUpdates": ["raw-base64-update"],
    "kafkaTail": {
      "topic": "sync-room-1",
      "partition": 0,
      "offset": "123"
    }
  }
}
```

#### Publish Update (`/collab/publish`)

```json
{
  "roomId": "default",
  "docId": "my-document-guid",
  "subdocId": "optional-subdoc",
  "version": "42",
  "senderId": "123456",
  "timestamp": 1700000000000,
  "channel": "doc",
  "note": "optional flag",
  "content": "base64-encoded-update-content"
}
```

#### Persist Snapshot (`/collab/persist`)

```json
{
  "docId": "my-document-guid",
  "subdocId": "optional-subdoc",
  "version": "42",
  "timestamp": 1700000000000,
  "snapshot": "base64-encoded-snapshot-or-json-string"
}
```

这些接口可以直接被 `apps/demo` 中的 ProseMirror+Provider 客户端调用，用于同步文档数据到服务端。在 demo 中可以将 Kafka topic 和 MySQL snapshot 当成持久层视角。

## 与 apps/demo 的协作

`apps/demo` 负责模拟 editor + `ProtocolProvider`，它使用 `@y-kafka-collabation-server/provider` 连接到 `kafka://<docId>` 的伪 WebSocket 并触发 `collab` 接口：

- 通过 `GET /collab/status` 获取服务端状态。
- 当 editor 内容变更（`doc.update`）时，通过 `POST /collab/publish` 发送 update payload。
- 可选地用 `POST /collab/persist` 将当前 state snapshot 持久化到 MySQL。

这个 demo/server 组合展示了 provider 如何在客户端与服务端 Kafka 架构之间打通，同时 server 端还能序列化保存 snapshot（模拟 MySQL）。

## 配置方式

当前版本通过 `apps/server/config/server.config.yaml` 统一管理 Kafka、MySQL 与对象存储配置，示例：

```yaml
kafka:
  clientId: collab-server
  brokers:
    - localhost:9092
  consumerGroup: collab-server-sync
  topics:
    sync: sync-{roomId}
    awareness: awareness-{roomId}
    control: control-{roomId}
  topicRoomPriority:
    - roomId
    - docId

mysql:
  host: 127.0.0.1
  port: 3306
  user: root
  password: ""
  database: collab
  synchronize: true
  poolSize: 10

storage:
  driver: local
  basePath: dist/data
```

- 若要调整配置，直接修改该 YAML 文件（或基于不同环境维护多份文件并在部署时覆盖）。
- YAML 中的值会作为 `ConfigService` 的最终来源，必要时仍可结合 `.env`（由 Nest 注入 `process.env`）提供额外变量给其他模块。

服务启动前请确保：

1. Kafka、MySQL、对象存储（本地目录/MinIO/S3 等）已经就绪；
2. `packages/persistence` 已构建，保证 `DocumentSnapshot`/`UpdateHistory` 实体可用；
3. MySQL 账户具备 `CREATE TABLE`、`INSERT`、`UPDATE` 权限。

## 启动流程

1. 启动 Kafka 与 MySQL（user 提供的机器即可）。
2. 在 `apps/server` 中：`pnpm --filter @y-kafka-collabation-server/server dev`。
3. 通过 `apps/demo` 中的 `ProtocolProvider` 客户端调用上述 `collab` 接口，或直接用 HTTP 工具调用 `POST /collab/publish`/`POST /collab/persist` 来模拟 provider 行为。

这样就能在真实 Kafka topic 与 MySQL snapshot 表之间观察到来自 editor 的数据流动。

### 依赖提示

`apps/server` 依赖 `@y-kafka-collabation-server/provider`、`@y-kafka-collabation-server/protocol` 等包，务必在 `packages/*` 构建后再运行，否则 `tsc`/`nest` 可能报找不到模块。
