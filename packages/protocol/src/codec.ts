/**
 * 标准的编码和解码器
 * 核心功能是提供把 yjs 的相关状态/metadata 编码成二进制格式，方便各类传输
 * 核心结构 [messageType:1][metadataLength:4 little endian][metadataBytes (JSON)][payloadBytes (不含 messageType)?]
 */
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { type Encoder } from 'lib0/encoding';

import { ProtocolMessageType, type ProtocolMessageMetadata } from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeMessage(
  messageType: ProtocolMessageType,
  metadata: ProtocolMessageMetadata,
  payloadOrWriter?: Uint8Array | ((_encoder: Encoder) => void),
): Uint8Array {
  const encoder = encoding.createEncoder();

  // 写入类型
  encoding.writeVarUint(encoder, messageType);

  // 写入 metadata
  const metadataJson = JSON.stringify(metadata);
  const metadataBytes = textEncoder.encode(metadataJson);
  const metadataLengthBuffer = new ArrayBuffer(4);
  const metadataLengthView = new DataView(metadataLengthBuffer);
  metadataLengthView.setUint32(0, metadataBytes.length, true); // 固定 4 字节 little endian
  encoding.writeUint8Array(encoder, new Uint8Array(metadataLengthBuffer)); // metadata 字节长度
  encoding.writeUint8Array(encoder, metadataBytes); // metadata 内容

  // 根据第三个参数的类型，写入相应的数据
  if (payloadOrWriter instanceof Uint8Array) {
    encoding.writeUint8Array(encoder, payloadOrWriter);
  } else if (typeof payloadOrWriter === 'function') {
    payloadOrWriter(encoder);
  }

  return encoding.toUint8Array(encoder);
}
