# @y-kafka-collabation-server/provider

用于 `y-kafka-collabation-server` 的高性能 Yjs provider 客户端。它采用了分层架构来处理连接、协议处理和文档状态管理，并支持 **多路复用 (Multiplexing)** 和 **Kafka Offsets**。

## 特性

- **多路复用 (Multiplexing)**：通过单个 Socket.IO 连接管理多个 `YDoc` 实例。
- **Kafka Offsets**：跟踪每条消息的 Kafka offset，以确保严格的顺序和一致性。
- **分层架构**：传输层、协议层和状态管理层关注点分离。
- **类型安全**：完整的 TypeScript 支持和类型化事件。

## 架构

Provider 采用三层架构构建：

1. **连接层 (`ProtocolConnection`)**
    - 管理 `Socket.IO` 客户端连接。
    - 处理原始消息信封 (Metadata + Payload)。
    - 从传入消息中提取 `offset` (Kafka offset)。
    - 发出类型化事件 (`message-sync`, `message-awareness` 等)。

2. **处理层 (`ProtocolProcessing`)**
    - 继承自 `ProtocolConnection`。
    - 实现 Yjs 协议逻辑 (Sync, Awareness, Auth, Control)。
    - 使用最新接收到的 Kafka offset 更新 `DocState`。

3. **管理层 (`ProtocolManager`)**
    - 继承自 `ProtocolProcessing`。
    - 管理多个 `Y.Doc` 实例的生命周期。
    - 使用 `Map<string, DocState>` 将消息路由到正确的文档。
    - 使用 `WeakMap<YDoc, DocState>` 跟踪元数据 (同步状态, offsets) 而不会导致内存泄漏。

## 数据流

### 入站 (Server -> Client)

1. **Socket.IO** 收到二进制消息。
2. **`ProtocolConnection`** 解码信封，提取：
    - `messageType` (Sync, Awareness 等)
    - `docId` (目标文档)
    - `offset` (Kafka offset)
3. **`ProtocolProcessing`** 处理特定的协议消息：
    - **Sync**：使用 `yjs` 将更新应用到 `YDoc`。
    - **Awareness**：更新 awareness 状态。
4. **`ProtocolManager`** 确保更新应用到通过 `docId` 找到的正确 `YDoc` 实例。

### 出站 (Client -> Server)

1. **`YDoc`** 在本地更改时触发 `update` 事件。
2. **`ProtocolManager`** (通过 `updateHandler`) 捕获更新。
3. **`ProtocolConnection`** 将更新封装在协议信封中。
4. **Socket.IO** 将二进制消息发送到服务器。

## 使用方法

```typescript
import { YKafkaCollabationProvider } from '@y-kafka-collabation-server/provider';
import { Doc } from '@y/y';

// 1. 创建 YDoc
const doc = new Doc();

// 2. 初始化 provider
// 自动连接并注册 doc
// roomname 可以是 'room-id' 或 'room-id/doc-id'
const provider = new YKafkaCollabationProvider(
  'http://localhost:3000',
  'my-room-id/my-doc-guid',
  doc
);

// 3. 监听事件
provider.on('synced', ({ docId, state }) => {
  console.log(`Document ${docId} synced: ${state}`);
});

provider.on('status', ({ status }) => {
  console.log('Connection status:', status);
});

// 4. 清理
// provider.destroy();
```

## API

### `YKafkaCollabationProvider`

#### 构造函数

`new YKafkaCollabationProvider(serverUrl: string, roomname: string, doc: YDoc, options?: YKafkaCollabationProviderOptions)`

- `serverUrl`: Socket.IO 服务器地址。
- `roomname`: 房间名，格式为 `room-id` 或 `room-id/doc-id`。
  - 如果包含 `/`，则分割，`room-id` 取第一部分，`doc-id` 取最后一部分。
  - 如果不包含 `/`，则尝试从 `options.docId` 或 `params` (keys: `docId`, `docid`, `doc-id`, `id`) 中获取 `doc-id`。
  - 如果都未找到，则 `doc-id` 默认为 `room-id`。
- `doc`: 主 `YDoc` 实例。
- `options`: 配置项。
  - `connect`: 是否自动连接 (默认 `true`)。
  - `docId`: 显式指定文档 ID (当 roomname 中未包含时)。
  - `awareness`: 自定义 Awareness 实例 (默认 `new Awareness(doc)`)。
  - `params`: URL 参数。
  - `resyncInterval`: 重同步间隔 (毫秒)。
  - `maxBackoffTime`: 最大重连退避时间。

#### 方法

继承自 `ProtocolManager`:

- `addDoc(doc: YDoc, options?: { docId?: string; parentId?: string; awareness?: Awareness })`: 注册额外的 doc (多路复用)。
- `removeDoc(doc: YDoc)`: 注销 doc。
- `destroy()`: 关闭连接并清理。

#### 事件

- `status`: 连接状态变更。
- `synced`: 文档同步状态变更。
- `permission-denied`: 认证失败。
- `connection-error`: Socket 错误。

## 依赖

- `socket.io-client`: 传输层。
- `@y-kafka-collabation-server/protocol`: 共享协议定义。
