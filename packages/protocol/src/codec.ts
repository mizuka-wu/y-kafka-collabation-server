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
  const metadataBytesLength = metadataBytes.length;

  encoding.writeUint16(encoder, metadataBytesLength); // 长度
  encoding.writeUint8Array(encoder, metadataBytes); // metadata 内容

  // 根据第三个参数的类型，写入相应的数据
  if (payloadOrWriter instanceof Uint8Array) {
    encoding.writeUint8Array(encoder, payloadOrWriter);
  } else if (typeof payloadOrWriter === 'function') {
    payloadOrWriter(encoder);
  }

  return encoding.toUint8Array(encoder);
}

export function decodeMessageType(
  data: Uint8Array | Buffer,
): ProtocolMessageType {
  const decoder = decoding.createDecoder(data);
  // 读取类型
  const messageType = decoding.readVarUint(decoder);
  return messageType;
}

export function decodeMetadata(data: Uint8Array | Buffer) {
  const decoder = decoding.createDecoder(data);

  // 跳过类型字段
  decoding.readVarUint(decoder);

  // 读取 metadata 长度
  const metadataLength = decoding.readUint16(decoder);

  // 读取 metadata 内容
  const metadataBytes = decoding.readUint8Array(decoder, metadataLength);
  const metadataJson = textDecoder.decode(metadataBytes);
  const metadata: ProtocolMessageMetadata = JSON.parse(metadataJson);

  return metadata;
}

export function decodePayload(data: Uint8Array | Buffer): Uint8Array {
  const decoder = decoding.createDecoder(data);

  // 跳过类型字段
  decoding.readVarUint(decoder);

  // 跳过 metadata 长度
  const metadataLength = decoding.readUint16(decoder);

  // 跳过 metadata 内容
  decoding.readUint8Array(decoder, metadataLength);

  // 返回剩余部分
}
