import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from '@y/protocols/awareness';
import { ProtocolMessageHandler, ProtocolMessageType } from '../types';

export const queryAwarenessHandler: ProtocolMessageHandler = (
  encoder,
  _decoder,
  context,
) => {
  encoding.writeVarUint(encoder, ProtocolMessageType.Awareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      context.awareness,
      Array.from(context.awareness.getStates().keys()),
    ),
  );
};
