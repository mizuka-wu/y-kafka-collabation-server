import * as encoding from 'lib0/encoding';
import * as syncProtocol from '@y/protocols/sync';
import { ProtocolMessageHandler, ProtocolMessageType } from '../types';

export const syncHandler: ProtocolMessageHandler = (
  encoder,
  decoder,
  context,
  emitSynced,
) => {
  encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    context.doc,
    context,
  );
  if (
    emitSynced &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !context.synced
  ) {
    context.setSynced(true);
  }
};
