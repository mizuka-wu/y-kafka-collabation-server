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

/**
 * 向 message 最前面追加 metadata 的相关信息
 */
export function appendMetadata(
  metadata: ProtocolMessageMetadata,
  message: ArrayBuffer,
): Uint8Array {
  const encoder = encoding.createEncoder();

  // 写入 metadata
  const metadataJson = JSON.stringify(metadata);
  const metadataBytes = textEncoder.encode(metadataJson);
  const metadataBytesLength = metadataBytes.length;

  encoding.writeUint16(encoder, metadataBytesLength); // 长度
  encoding.writeUint8Array(encoder, metadataBytes); // metadata 内容

  // 写入原始数据
  encoding.writeUint8Array(encoder, new Uint8Array(message));

  return encoding.toUint8Array(encoder);
}

export function readMetadata(message: ArrayBuffer): ProtocolMessageMetadata {
  const decoder = decoding.createDecoder(new Uint8Array(message));
  // 读取 metadata 长度
  const metadataLength = decoding.readUint16(decoder);

  // 读取 metadata 内容
  const metadataBytes = decoding.readUint8Array(decoder, metadataLength);
  const metadataJson = textDecoder.decode(metadataBytes);
  const metadata: ProtocolMessageMetadata = JSON.parse(metadataJson);
  return metadata;
}

export function removeMetadata(message: ArrayBuffer): ArrayBuffer {
  const decoder = decoding.createDecoder(new Uint8Array(message));
  const metadataLength = decoding.readUint16(decoder);
  return message.slice(decoder.pos + metadataLength);
}
