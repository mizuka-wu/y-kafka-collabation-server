import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from '@y/y';
import * as syncProtocol from '@y/protocols/sync';
import * as authProtocol from '@y/protocols/auth';
import * as awarenessProtocol from '@y/protocols/awareness';
import {
  ProtocolMessageHandler,
  ProtocolMessageMetadata,
  ProtocolCodecContext,
  ProtocolMessageType,
} from './types';
import { syncHandler } from './handlers/sync';
import { awarenessHandler } from './handlers/awareness';
import { authHandler } from './handlers/auth';
import { queryAwarenessHandler } from './handlers/queryAwareness';

const messageHandlers: Record<ProtocolMessageType, ProtocolMessageHandler> = {
  [ProtocolMessageType.Sync]: syncHandler,
  [ProtocolMessageType.Awareness]: awarenessHandler,
  [ProtocolMessageType.Auth]: authHandler,
  [ProtocolMessageType.QueryAwareness]: queryAwarenessHandler,
};

/**
 * 解析 Yjs 消息并返回需要回复的 payload（例如 SyncStep2）。
 */
export const decodeMessage = (
  context: ProtocolCodecContext,
  buffer: Uint8Array,
  emitSynced = false,
): Uint8Array | null => {
  const decoder = decoding.createDecoder(buffer);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder) as ProtocolMessageType;
  const handler = messageHandlers[messageType];
  if (!handler) {
    console.warn('Unknown message type', messageType);
    return null;
  }
  handler(encoder, decoder, context, emitSynced);
  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null;
};

/**
 * 编码一个同步步骤 1 消息，与 y-websocket 保持一致，方便服务端响应 SyncStep2。
 */
export const encodeSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

/**
 * 同步步骤 2：将缺失数据发送给请求端。
 */
export const encodeSyncStep2 = (
  doc: Y.Doc,
  stateVector?: Uint8Array,
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
  syncProtocol.writeSyncStep2(encoder, doc, stateVector);
  return encoding.toUint8Array(encoder);
};

/**
 * 直接转发 update 消息，便于实现独立的 update 通道。
 */
export const encodeUpdate = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

/**
 * Awareness 状态广播，参考 messageAwareness Handler。
 */
export const encodeAwareness = (
  awareness: awarenessProtocol.Awareness,
  clientIds?: number[],
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ProtocolMessageType.Awareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      clientIds ?? Array.from(awareness.getStates().keys()),
    ),
  );
  return encoding.toUint8Array(encoder);
};

/**
 * 查询 Awareness（Query Awareness）时的返回行为与 messageAwareness 相同。
 */
export const encodeQueryAwareness = (
  awareness: awarenessProtocol.Awareness,
): Uint8Array => encodeAwareness(awareness);

/**
 * 鉴权失败通知，可用于服务端响应 messageAuth。
 */
export const encodePermissionDenied = (reason: string): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, ProtocolMessageType.Auth);
  authProtocol.writePermissionDenied(encoder, reason);
  return encoding.toUint8Array(encoder);
};

/**
 * 将 payload + metadata 封装为 Kafka 可落盘的 JSON 字符串（base64 payload）。
 */
export const encodeKafkaEnvelope = (
  payload: Uint8Array,
  metadata: ProtocolMessageMetadata,
): Uint8Array => {
  const envelope = {
    metadata,
    payload: Buffer.from(payload).toString('base64'),
  };
  return Buffer.from(JSON.stringify(envelope));
};

/**
 * 反序列化 Kafka payload 并还原 metadata + 原始 Yjs 二进制。
 */
export const decodeKafkaEnvelope = (
  buffer: Uint8Array,
): { metadata: ProtocolMessageMetadata; payload: Uint8Array } => {
  const raw = new TextDecoder().decode(buffer);
  const { metadata, payload } = JSON.parse(raw);
  return {
    metadata,
    payload: Buffer.from(payload, 'base64'),
  };
};

/**
 * 生成标准 metadata 示例，包含 subdoc，方便上层调用。
 */
export const createMetadata = (
  doc: Y.Doc,
  roomId?: string,
  subdocId?: string,
): ProtocolMessageMetadata => ({
  roomId: roomId ?? doc.guid,
  docId: doc.guid,
  subdocId,
  senderId: String(doc.clientID),
  timestamp: Date.now(),
});
