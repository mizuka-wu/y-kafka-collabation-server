# 协议升级计划：Metadata 前置格式

## 背景

- 现有顺序为 `[VarUint messageType][Uint16 metadataLength][metadata JSON][payload body]`，限制了上层复用 yjs 原有编码逻辑。
- 新方案统一改为 `[Uint16 metadataLength][metadata JSON][VarUint messageType][payload body]`，以便 provider/server 等直接把完整 yjs payload 作为 `metadata` 之后的子缓冲区传递。

## 目标

1. 让 metadata 以固定长度头开场，便于提前路由（room/doc/topic）。
2. `messageType + payload` 完全复用 yjs 现成实现，Kafka 只包一层 metadata。
3. 上下游 producer/consumer 在一帧中即可完成 metadata 解析和 payload 转发。

## 范围

- `packages/protocol`：codec、Kafka envelope、测试、README。
- `packages/transport`、`packages/runtime`、`packages/provider`、`packages/persistence`、`apps/server`、`apps/demo`：凡是手写读取顺序的代码与示例。
- 文档与 ADR（根 README、package README、外部协议说明）。

## 实施步骤

1. **Protocol Codec**
   - `encodeMessage`：写入 `Uint16` 长度 + metadata JSON（UTF-8），再写 `VarUint messageType` 与 payload（若存在）。
   - `decodeMetadata`/`decodeMessageType`/`decodePayload`：顺序相应调整，读取 metadata 后再读 messageType。
   - 若需要兼容旧格式，可临时保留 legacy 读写器，通过 feature flag 控制；当前计划为破坏式升级，默认不保留。
2. **Kafka Envelope (`packages/protocol/src/index.ts`)**
   - `encodeKafkaEnvelope`：直接拼出 `[metadataLength][metadataBytes][payload (含 messageType)]`。
   - `decodeKafkaEnvelope`：解析 metadata 后返回原始 payload（无需再补 messageType），`messageType` 可在需要时通过 `decoding.readVarUint` 获得。
3. **上下游模块**
   - 生产侧：先生成 yjs 二进制（含 messageType），随后调用新的 `encodeKafkaEnvelope(metadata, payload)`。
   - 消费侧：`decodeKafkaEnvelope` 后拿到 metadata + 原始 payload，直接交给原有 yjs handler。
   - 检查任何依赖“首字节即 messageType”的逻辑，改为使用 codec API 而不是手工切片。
4. **测试**
   - 更新 `packages/protocol/src/__tests__/codec.test.ts` 的快照与断言，覆盖 metadata 前置情况。
   - 若 transport/server 有集成测试，更新样本数据。
5. **文档与版本**
   - README、包内文档同步新的格式图示。
   - 在 package.json 或 CHANGELOG 中标注 breaking change，准备发布新的 major 版本。

## 验证清单

- [ ] Kafka round-trip：encode -> decode -> 原始 payload 一致。
- [ ] Provider/transport e2e：客户端发出的 yjs payload 能在服务端复用，无需额外拷贝。
- [ ] Metadata 路由：roomId/docId 能在读取前 2 字节+JSON 中立即得到。
- [ ] 无依赖旧顺序的残留逻辑。

## 文档需更新

1. 根目录 README：Kafka envelope 描述、消息结构章节。
2. `packages/protocol/README.md`：协议格式、示例代码、图表。
3. 其他引用协议布局的包 README 或 ADR（runtime/provider/persistence 等）。
4. 若有对外 API/接入文档，同步升级要求与发布计划。

## 发布策略

- 破坏式升级，建议：
  1. 完成全部代码改动与测试。
  2. bump 所有受影响 package 的 major version。
  3. 准备迁移指南，包括如何一次性发布 producer 与 consumer。
  4. 在 release note 中强调 metadata 位置变化及其好处。
