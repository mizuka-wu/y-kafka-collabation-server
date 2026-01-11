import * as authProtocol from '@y/protocols/auth';
import type { ProtocolMessageHandler } from '../types';

export const authHandler: ProtocolMessageHandler = (
  _encoder,
  decoder,
  context,
) => {
  authProtocol.readAuthMessage(decoder, context.doc, (_doc, reason) =>
    context.permissionDeniedHandler?.(reason),
  );
};
