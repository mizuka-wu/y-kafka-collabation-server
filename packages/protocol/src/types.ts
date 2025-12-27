import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as Y from '@y/y';
import * as awarenessProtocol from '@y/protocols/awareness';

/**
 * 与 y-websocket 保持一致的消息类型编号。
 */
export enum ProtocolMessageType {
  Sync = 0,
  Awareness = 1,
  Auth = 2,
  QueryAwareness = 3,
}

/**
 * 上层协议需要的元信息，可以顺序发送到 WebSocket/Kafka。
 */
export interface ProtocolMessageMetadata {
  roomId: string;
  docId: string;
  subdocId?: string;
  senderId?: string;
  version?: number;
  timestamp?: number;
  note?: string;
}

/**
 * 用于处理来自 y-websocket 的 workers/广播消息的上下文。
 */
export interface ProtocolCodecContext {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
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
