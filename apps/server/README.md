# @y-kafka-collabation-server/server

## Overview

`apps/server` 现在是用于演示 Kafka + MySQL 协同与 `ProtocolProvider` 协作的基础服务。它通过 `ServerCollabService` 提供简化的 Kafka topic、MySQL snapshot 存储接口，并允许 `apps/demo` 中的 `ProtocolProvider` 客户端通过 REST API 推送数据。

## 运行

1. 在根目录先安装依赖：`pnpm install`。
2. 在 server 目录运行开发服务：`pnpm --filter @y-kafka-collabation-server/server dev`。

服务默认监听 [http://localhost:3000](http://localhost:3000)。

## 提供的 API

| 路径 | 方法 | 描述 |
| --- | --- | --- |
| `GET /collab/status` | GET | 返回当前已知文档的 Kafka 消息数和最新 MySQL snapshot。 |
| `POST /collab/publish` | POST | 接收 `{ docId, content }`，将内容写入模拟 Kafka topic。 |
| `POST /collab/persist` | POST | 接收 `{ docId, snapshot }`，将快照写入模拟 MySQL。 |
| `GET /collab/messages?docId=...` | GET | （可选拓展）查看 `docId` 下的 Kafka 消息列表。 |

这些接口可以直接被 `apps/demo` 中的 ProseMirror+Provider 客户端调用，用于同步文档数据到服务端。在 demo 中可以将 Kafka topic 和 MySQL snapshot 当成持久层视角。

## 与 apps/demo 的协作

`apps/demo` 负责模拟 editor + `ProtocolProvider`，它使用 `@y-kafka-collabation-server/provider` 连接到 `kafka://<docId>` 的伪 WebSocket 并触发 `collab` 接口：

- 通过 `GET /collab/status` 获取服务端状态。
- 当 editor 内容变更（`doc.update`）时，通过 `POST /collab/publish` 发送 update payload。
- 可选地用 `POST /collab/persist` 将当前 state snapshot 持久化到 MySQL。

这个 demo/server 组合展示了 provider 如何在客户端与服务端 Kafka 架构之间打通，同时 server 端还能序列化保存 snapshot（模拟 MySQL）。

## 运行前提

| 变量 | 默认 | 描述 |
| --- | --- | --- |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka 集群地址，可传递多个 host，逗号分隔。 |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 服务器地址。 |
| `MYSQL_PORT` | `3306` | MySQL 端口。 |
| `MYSQL_USER` | `root` | MySQL 用户名。 |
| `MYSQL_PASSWORD` | `(空)` | MySQL 密码。 |
| `MYSQL_DATABASE` | `collab` | 存储 snapshot 的数据库名称。 |

服务启动前请确保 Kafka 和 MySQL 已经运行，可让本地出具的 Kafka 服务监听 `KAFKA_BROKERS`，MySQL 对应账户拥有 `CREATE TABLE` 和 `INSERT` 权限。

## 环境变量配置

`apps/server` 直接从 `process.env` 读取上方表格中的变量。推荐在项目根目录或 `apps/server` 下创建一个 `.env` 文件（该文件可由 `dotenv` 在启动脚本中加载）并只填写你需要覆盖的字段，例如：

```
KAFKA_BROKERS=localhost:9092
MYSQL_HOST=127.0.0.1
MYSQL_USER=root
MYSQL_DATABASE=collab
```

如果不设置任何变量，服务会使用表格里列出的本地默认值，因此你可以先在本地启动 Kafka/MySQL 并直接运行 `pnpm --filter @y-kafka-collabation-server/server dev`。

## 启动流程

1. 启动 Kafka 与 MySQL（user 提供的机器即可）。
2. 在 `apps/server` 中：`pnpm --filter @y-kafka-collabation-server/server dev`。
3. 通过 `apps/demo` 中的 `ProtocolProvider` 客户端调用上述 `collab` 接口，或直接用 HTTP 工具调用 `POST /collab/publish`/`POST /collab/persist` 来模拟 provider 行为。

这样就能在真实 Kafka topic 与 MySQL snapshot 表之间观察到来自 editor 的数据流动。

### 依赖提示

`apps/server` 依赖 `@y-kafka-collabation-server/provider`、`@y-kafka-collabation-server/protocol` 等包，务必在 `packages/*` 构建后再运行，否则 `tsc`/`nest` 可能报找不到模块。
