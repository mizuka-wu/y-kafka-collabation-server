# 基于 Kafka 的协作数据模型

本 README 只描述数据模型与各层之间的转换规则，方便后续在 packages 下重写实现。历史架构、包划分与接口说明请移步 `docs/ARCHITECTURE.md`。

## 1. 事件模型

系统只认可「协议事件」这一种载体。任何来自客户端、持久化或调度器的输入都需要被序列化为统一的 `ProtocolMessage`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `roomId` | `string` | 逻辑文档集合，同一 room 共享 topic。 |
| `docId` | `string` | 具体 Y.Doc 或聚合子文档的唯一标识。 |
| `subdocId?` | `string` | 可选，描述子树/分片。 |
| `channel` | `'doc' \| 'awareness' \| 'control'` | 区分增量同步、在线状态与控制命令。 |
| `version` | `string \| number` | 单调递增，用于持久化排序与幂等。 |
| `senderId` | `string` | 客户端/服务节点的实例 ID，消费端根据它跳过自回放。 |
| `timestamp` | `number` | 事件生成时间（毫秒）。 |
| `payload` | `Uint8Array` | 具体的 Yjs update / awareness diff。 |

所有派生的概念都建立在上述字段之上：Kafka topic 通过 `roomId`/`channel` 推导、聚合策略依赖 `docId`/`subdocId`，权限控制依赖 `senderId`/`docId` 映射。

## 2. 转换规则

### 2.1 Socket.IO / HTTP → Kafka

1. 客户端提交原始的 Yjs buffer（SyncStep/Awareness diff）。  
2. 边缘节点在握手阶段补全 `roomId`、`docId`、`senderId`，将 Buffer 转成 `Uint8Array`。  
3. 使用 `encodeKafkaEnvelope(metadata, payload)` 将事件包裹为 Kafka 消息，Key 取 `docId`（保证同文档顺序）。  
4. `channel` 决定 topic：`doc` → `sync-{roomId}`，`awareness` → `awareness-{roomId}`，`control` 则由调度配置决定。  

### 2.2 Kafka → Socket.IO / HTTP

1. Consumer 解出 `metadata/payload`。  
2. 根据 `roomId/docId/subdocId` 查询连接上下文（或 HTTP 订阅者）。  
3. 使用 `senderId` 判断是否需要回退给原发送者。  
4. 将 `payload` 原样推送给客户端；如果是 HTTP 降级则聚合多个 payload（参见 2.4）。  

### 2.3 Kafka → Persistence

1. 只处理 `channel === 'doc'`。  
2. `version` 作为数据库主排序键；快照写入 `document_snapshots`，增量写入 `update_history`。  
3. `storageLocation`（可选）由对象存储实现维护；当快照超过内存阈值时只保存引用。  

### 2.4 聚合 / 转码

* **聚合准则**：相同 `(docId, subdocId, channel)` 的连续消息可使用 `rys` 或定制 reducer 合并。  
* **降级回放**：HTTP 读取流程 = Snapshot (`Base64`) + History (`Base64[]`) + Kafka Tail (`Uint8Array[]`)。  
* **控制面**：`channel === 'control'` 的 payload 按自定义 schema 解析，例如 `{ type: 'snapshot', targetDocId }`。  

## 3. 典型流向

```text
Client Update
  → 填充 metadata（room/doc/sender/version）
  → encodeKafkaEnvelope
  → Kafka Topic (sync-roomA)
  → Consumer decodeKafkaEnvelope
  → 广播/持久化/调度
```

```text
HTTP Snapshot 请求
  → ServerCollabService.getDocumentState(docId)
  → snapshot(Base64) + updates(Base64[])
  → 客户端重建本地 Y.Doc
```

## 4. 扩展点

1. **TopicResolver**：根据租户、room、channel 输出不同 topic 模板。  
2. **RoomRegistry**：可替换为 Redis / 任意边缘状态同步方案。  
3. **ObjectStorageClient**：兼容本地、S3、OSS 等存储驱动，接口固定 `putObject/getObject`.  
4. **Authorization Hook**：基于 `ProtocolMessageMetadata` 的 `(senderId, docId)` 关系校验，应在进入 Kafka 之前完成。  

以上描述构成了未来重构的唯一约束：任何实现都只需满足事件模型和转码规则，即可自由拆分包或替换通信层。
