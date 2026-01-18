import type { Socket, ManagerOptions, SocketOptions } from 'socket.io-client';
import { YDoc, Awareness } from 'ywasm';
import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';

export interface ProtocolProviderOptions {
  /**
   * Socket.io server URL
   */
  url: string;
  /**
   * Room ID (required for connection)
   */
  roomId: string;
  /**
   * Auth token / params
   */
  params?: { [key: string]: string };
  /**
   * Auto connect (default: true)
   */
  autoConnect?: boolean;
  /**
   * Socket options
   */
  socketOptions?: Partial<ManagerOptions & SocketOptions>;
  /**
   * Request server state every `resyncInterval` milliseconds
   * Default: 30000
   */
  resyncInterval?: number;
}

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

export type ProviderEvents = {
  status: (payload: { status: ProviderStatus }) => void;
  synced: (payload: { docId: string; state: boolean }) => void;
  'connection-close': (reason: Socket.DisconnectReason) => void;
  'connection-error': (error: Error) => void;
  control: (type: number, content: Uint8Array) => void;
  'permission-denied': (reason: string) => void;
  'doc-loaded': (docId: string) => void;
  // Internal message events
  'message-sync': (
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
    offset?: string,
  ) => void;
  'message-awareness': (
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
    offset?: string,
  ) => void;
  'message-control': (
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
    offset?: string,
  ) => void;
  'message-auth': (
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
    offset?: string,
  ) => void;
};

export interface DocState {
  doc: YDoc;
  docId: string;
  parentId?: string;
  synced: boolean;
  offset?: string; // Kafka offset
  awareness: Awareness;
  // Handlers to be cleaned up
  updateHandler: (update: Uint8Array, origin: unknown) => void;
  awarenessUpdateHandler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;
}
