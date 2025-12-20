import * as awarenessProtocol from '@y/protocols/awareness';
import * as decoding from 'lib0/decoding';
import {
  ProtocolCodecContext,
  ProtocolMessageHandler,
  ProtocolMessageType,
} from '../types';

export const awarenessHandler: ProtocolMessageHandler = (
  _encoder,
  decoder,
  context,
) => {
  awarenessProtocol.applyAwarenessUpdate(
    context.awareness,
    decoding.readVarUint8Array(decoder),
    context,
  );
};
