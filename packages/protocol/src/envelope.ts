import { appendMetadata, readMetadata, removeMetadata } from './codec';
import type { ProtocolMessageMetadata } from './types';

const toArrayBuffer = (input: Uint8Array | ArrayBuffer): ArrayBuffer => {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  const buffer = new ArrayBuffer(input.byteLength);
  const view = new Uint8Array(buffer);
  view.set(input);
  return buffer;
};

/**
 * 将元数据附加在消息前方，得到 envelope。
 */
export const encodeEnvelope = (
  payload: Uint8Array,
  metadata: ProtocolMessageMetadata,
): Uint8Array => {
  if (payload.length === 0) {
    throw new Error('Envelope payload cannot be empty');
  }
  const payloadBuffer = toArrayBuffer(payload);
  return appendMetadata(metadata, payloadBuffer);
};

/**
 * 从 envelope 中解析 metadata，并返回去掉 metadata 后的 payload。
 */
export const decodeEnvelope = (
  message: Uint8Array | ArrayBuffer,
): {
  metadata: ProtocolMessageMetadata;
  payload: Uint8Array;
} => {
  const buffer = toArrayBuffer(message);
  const metadata = readMetadata(buffer);
  const payloadBuffer = removeMetadata(buffer);
  return {
    metadata,
    payload: new Uint8Array(payloadBuffer),
  };
};

export const decodeMetadataFromMessage = (
  message: Uint8Array | ArrayBuffer,
): ProtocolMessageMetadata => readMetadata(toArrayBuffer(message));
