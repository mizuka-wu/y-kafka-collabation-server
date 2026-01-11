import { ProtocolMessageMetadata } from './types';

import type * as Y from '@y/y';

export { ProtocolMessageType } from './types';
export type {
  ProtocolCodecContext,
  ProtocolMessageMetadata,
  ProtocolMessageHandler,
  ProtocolMessageEventPayload,
} from './types';
export {
  encodeEnvelope,
  decodeEnvelope,
  decodeMetadataFromEnvelope,
} from './envelope';

/**
 * 默认的协议的相关消息在 socketio 内的事件名称
 */
export const ProtocolMessageEventName = 'protocol-message';

/**
 * 生成标准 metadata 示例，包含 subdoc，方便上层调用。
 */
export const createMetadata = (
  doc: Y.Doc,
  roomId: string,
  docId: string,
  subdocId?: string,
): ProtocolMessageMetadata => ({
  roomId,
  docId,
  subdocId,
  senderId: String(doc.clientID),
  timestamp: Date.now(),
});
