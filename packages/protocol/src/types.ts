import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as awarenessProtocol from '@y/protocols/awareness';

import {
  messageAuth,
  messageAwareness,
  messageQueryAwareness,
  messageSync,
} from '@y/websocket';

import type * as Y from '@y/y';

/**
 * 与 y-websocket 保持一致的消息类型编号。
 */
export enum ProtocolMessageType {
  Sync = messageSync,
  Awareness = messageAwareness,
  Auth = messageAuth,
  QueryAwareness = messageQueryAwareness,
}

/**
 * 上层协议需要的元信息，可以顺序发送到 WebSocket/Kafka。
 */
export interface ProtocolMessageMetadata {
  /** 房间 ID */
  roomId: string;
  /** 文档 ID */
  docId: string;
  /** 父文档 ID（用于嵌套结构） */
  parentId?: string;
  /** 发送者 ID */
  senderId?: string;
  /** 协同版本 */
  version?: string;
  /** 时间戳 */
  timestamp?: number;
}

/**
 * 用于处理来自 y-websocket 的 workers/广播消息的上下文。
 */
export interface ProtocolCodecContext {
  doc: Y.Doc;
  awareness?: awarenessProtocol.Awareness;
  synced: boolean;
  /**
   * 更新同步状态（SyncStep2 收到后由上层存储）。
   */
  setSynced: (value: boolean) => void;
  /**
   * 当服务端返回鉴权拒绝时触发。
   */
  permissionDeniedHandler?: (reason: string) => void;
}

export type ProtocolMessageHandler = (
  encoder: encoding.Encoder,
  decoder: decoding.Decoder,
  context: ProtocolCodecContext,
  emitSynced: boolean,
) => void;

/**
 * Kafka 下行事件 payload，供 transport/provider 共享。
 */
export interface ProtocolMessageEventPayload {
  topic: string;
  partition?: number;
  offset?: string;
  message: Uint8Array;
}
