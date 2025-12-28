import type * as Y from 'yjs';
import * as awarenessProtocol from '@y/protocols/awareness';
import { io, Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
import { Buffer } from 'buffer';
import {
  ProtocolCodecContext,
  ProtocolMessageMetadata,
  createMetadata,
  decodeKafkaEnvelope,
  encodeKafkaEnvelope,
  encodeSyncStep1,
  encodeUpdate,
  encodeAwareness,
  decodeMessage,
} from '@y-kafka-collabation-server/protocol';

const toBase64 = (buf: Uint8Array): string =>
  Buffer.from(buf).toString('base64');

const fromBase64 = (value: string): Uint8Array => Buffer.from(value, 'base64');

type ProtocolSocketMessage = {
  docId: string;
  payload: string;
};

type ClientProtocolMessage = {
  docId: string;
  roomId: string;
  payload: string;
};

type AwarenessChangePayload = {
  readonly added: number[];
  readonly updated: number[];
  readonly removed: number[];
};

type SocketListeners = {
  connect: () => void;
  disconnect: (reason: Socket.DisconnectReason) => void;
  connectError: (error: Error) => void;
  protocolMessage: (message: ProtocolSocketMessage) => void;
  joined: (payload: { docId: string }) => void;
};

export type ProviderStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'denied';

export type ProtocolProviderEvent =
  | 'status'
  | 'sync'
  | 'awareness'
  | 'error'
  | 'permission-denied';

type EventMap = {
  status: [ProviderStatus];
  sync: [];
  awareness: [AwarenessChangePayload];
  error: [unknown];
  'permission-denied': [string];
};

export interface ProtocolProviderOptions {
  /**
   * Socket.io 服务端地址，需支持 `protocol-message` / `join` 事件。
   */
  url: string;
  /**
   * 连接所在 roomId（作为文档类型，默认为 'default'）。
   */
  roomId?: string;
  /**
   * 可选 subdocId，用于 metadata 精确路由。
   */
  subdocId?: string;
  /**
   * 可选 docId（默认使用 doc.guid），在一个 room 承载多个 doc 时可显式指定。
   */
  docId?: string;
  /**
   * 是否自动连接。
   */
  autoConnect?: boolean;
  /**
   * 是否在连接断开后尝试重连。
   */
  reconnect?: boolean;
  /**
   * 重连的最小间隔（ms）。
   */
  reconnectInterval?: number;
  /**
   * 重连的最大间隔（ms）。
   */
  reconnectMaxInterval?: number;
  /**
   * 最大重连次数，超过后不再尝试。
   */
  maxReconnectAttempts?: number;
  /**
   * 复用外部创建的 Socket.io 连接。如果不提供则由 provider 自行创建。
   */
  socket?: Socket;
  /**
   * 当 provider 负责创建 socket 时，可通过此参数覆写 socket.io 的连接配置。
   */
  socketOptions?: Partial<ManagerOptions & SocketOptions>;
  /**
   * 允许在 metadata 生成后做额外处理（例如加上 version/trace）。
   */
  metadataCustomizer?: (
    metadata: ProtocolMessageMetadata,
    payload?: Uint8Array,
  ) => ProtocolMessageMetadata;
  /**
   * 重用用户创建的 awareness 实例。
   */
  awareness?: awarenessProtocol.Awareness;
}

type PendingMessage = {
  payload: Uint8Array;
  metadataOverrides?: Partial<ProtocolMessageMetadata>;
};

export class ProtocolProvider implements ProtocolCodecContext {
  public readonly doc: Y.Doc;
  public readonly awareness: awarenessProtocol.Awareness;
  public synced = false;
  public permissionDeniedHandler?: (reason: string) => void;

  private readonly options: ProtocolProviderOptions;
  private readonly metadataCustomizer?: ProtocolProviderOptions['metadataCustomizer'];
  private socket?: Socket;
  private socketAttached = false;
  private isExternalSocket = false;
  private joinedRoom = false;
  private socketListeners?: SocketListeners;
  private readonly listeners = new Map<
    ProtocolProviderEvent,
    Set<(...args: unknown[]) => void>
  >();
  private pendingMessages: PendingMessage[] = [];
  private _status: ProviderStatus = 'disconnected';
  private readonly awarenessListener: (changes: AwarenessChangePayload) => void;
  private readonly docUpdateListener: (
    update: Uint8Array,
    origin?: unknown,
  ) => void;

  constructor(doc: Y.Doc, options: ProtocolProviderOptions) {
    this.doc = doc;
    this.options = {
      autoConnect: true,
      reconnect: true,
      reconnectInterval: 500,
      reconnectMaxInterval: 10000,
      ...options,
    };
    this.metadataCustomizer = this.options.metadataCustomizer;
    this.awareness =
      this.options.awareness ?? new awarenessProtocol.Awareness(this.doc);

    this.awarenessListener = this.onAwarenessChange.bind(this);
    this.docUpdateListener = this.onDocUpdate.bind(this);
    this.doc.on('update', this.docUpdateListener);
    this.awareness.on('update', this.awarenessListener);

    this.permissionDeniedHandler = (reason: string) => {
      this.setStatus('denied');
      this.emit('permission-denied', reason);
      this.disconnect();
    };

    if (this.options.autoConnect) {
      this.connect();
    }
  }

  public get status(): ProviderStatus {
    return this._status;
  }

  public on<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void,
  ): void {
    const set =
      this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
    set.add(handler as (...args: unknown[]) => void);
    this.listeners.set(event, set);
  }

  public off<K extends keyof EventMap>(
    event: K,
    handler: (...args: EventMap[K]) => void,
  ): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  public connect(): void {
    if (!this.socketAttached) {
      const socket = this.options.socket ?? this.createInternalSocket();
      this.attachSocket(socket, Boolean(this.options.socket));
    }

    if (!this.socket) {
      throw new Error('Socket 尚未初始化');
    }

    if (this.socket.connected) {
      this.setStatus('connected');
      this.joinRoom();
      return;
    }

    this.setStatus('connecting');

    if (!this.isExternalSocket) {
      this.socket.connect();
    }
  }

  public disconnect(): void {
    this.joinedRoom = false;
    this.clearPending();

    if (this.socket && !this.isExternalSocket) {
      this.socket.disconnect();
    }

    this.setStatus('disconnected');
  }

  public destroy(): void {
    this.disconnect();
    this.doc.off('update', this.docUpdateListener);
    this.awareness.off('update', this.awarenessListener);
    this.detachSocket();
    if (this.socket && !this.isExternalSocket) {
      this.socket.close();
    }
    this.socket = undefined;
    this.socketAttached = false;
  }

  public setSynced(value: boolean): void {
    if (this.synced === value) {
      return;
    }
    this.synced = value;
    if (value) {
      this.emit('sync');
    } else {
      this.setStatus('syncing');
    }
  }

  private get targetDocId(): string {
    return this.options.docId ?? this.doc.guid;
  }

  private get targetRoomId(): string {
    return this.options.roomId ?? 'default';
  }

  private get isSocketReady(): boolean {
    return Boolean(this.socket && this.socket.connected && this.joinedRoom);
  }

  private createInternalSocket(): Socket {
    return io(this.options.url, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: this.options.reconnect ?? true,
      reconnectionAttempts: this.options.maxReconnectAttempts,
      reconnectionDelay: this.options.reconnectInterval,
      reconnectionDelayMax: this.options.reconnectMaxInterval,
      ...this.options.socketOptions,
    });
  }

  private attachSocket(socket: Socket, isExternal: boolean): void {
    this.detachSocket();
    this.socket = socket;
    this.isExternalSocket = isExternal;
    this.socketAttached = true;

    const handleConnect = () => {
      this.setStatus('connected');
      this.joinedRoom = false;
      this.joinRoom();
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleDisconnect = (_reason: Socket.DisconnectReason) => {
      this.joinedRoom = false;
      this.synced = false;
      this.setStatus('disconnected');
    };

    const handleConnectError = (error: Error) => {
      this.emit('error', error);
    };

    const handleProtocolMessage = (message: ProtocolSocketMessage) => {
      if (!message || message.docId !== this.targetDocId) {
        return;
      }
      try {
        const buffer = fromBase64(message.payload);
        this.processEnvelope(buffer);
      } catch (error) {
        this.emit('error', error);
      }
    };

    const handleJoined = (payload: { docId: string }) => {
      if (!payload || payload.docId !== this.targetDocId) {
        return;
      }
      this.joinedRoom = true;
      this.setSynced(false);
      this.flushPending();
      this.sendSyncStep1();
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('protocol-message', handleProtocolMessage);
    socket.on('joined', handleJoined);

    this.socketListeners = {
      connect: handleConnect,
      disconnect: handleDisconnect,
      connectError: handleConnectError,
      protocolMessage: handleProtocolMessage,
      joined: handleJoined,
    };
  }

  private detachSocket(): void {
    if (!this.socket || !this.socketListeners) {
      return;
    }
    const listeners = this.socketListeners;
    this.socket.off('connect', listeners.connect);
    this.socket.off('disconnect', listeners.disconnect);
    this.socket.off('connect_error', listeners.connectError);
    this.socket.off('protocol-message', listeners.protocolMessage);
    this.socket.off('joined', listeners.joined);
    this.socketListeners = undefined;
  }

  private joinRoom(): void {
    if (!this.socket) {
      return;
    }
    const docId = this.targetDocId;
    this.socket.emit('join', { docId });
  }

  private processEnvelope(buffer: Uint8Array): void {
    const { metadata, payload: remotePayload } = decodeKafkaEnvelope(buffer);
    const reply = decodeMessage(this, remotePayload, true);
    if (reply) {
      this.queueMessage(reply, {
        roomId: metadata.roomId,
        docId: metadata.docId,
        subdocId: metadata.subdocId,
        version: metadata.version,
      });
    }
  }

  private queueMessage(
    payload: Uint8Array,
    overrides?: Partial<ProtocolMessageMetadata>,
  ): void {
    this.pendingMessages.push({ payload, metadataOverrides: overrides });
    this.flushPending();
  }

  private flushPending(): void {
    if (!this.isSocketReady) {
      return;
    }
    while (this.pendingMessages.length > 0) {
      const next = this.pendingMessages.shift();
      if (!next) {
        continue;
      }
      const metadata = this.createMetadata(
        next.metadataOverrides,
        next.payload,
      );
      const envelope = encodeKafkaEnvelope(next.payload, metadata);
      this.sendEnvelope(
        metadata.docId ?? this.targetDocId,
        metadata.roomId,
        envelope,
      );
    }
  }

  private sendEnvelope(
    docId: string,
    roomId: string | undefined,
    envelope: Uint8Array,
  ): void {
    if (!this.socket) {
      return;
    }
    const payload = toBase64(envelope);
    const message: ClientProtocolMessage = {
      docId,
      roomId: roomId ?? this.targetRoomId,
      payload,
    };
    this.socket.emit('protocol-message', message);
  }

  private sendSyncStep1(): void {
    const payload = encodeSyncStep1(this.doc);
    this.queueMessage(payload, { note: 'sync-request' });
  }

  private onDocUpdate(update: Uint8Array, origin?: unknown): void {
    if (origin === this) {
      return;
    }
    const payload = encodeUpdate(update);
    this.queueMessage(payload, { note: 'update' });
  }

  private onAwarenessChange(changes: AwarenessChangePayload): void {
    const localId = this.awareness.clientID;
    const touched = [...changes.added, ...changes.updated, ...changes.removed];
    if (!touched.includes(localId)) {
      return;
    }
    const payload = encodeAwareness(this.awareness);
    this.queueMessage(payload, { note: 'awareness' });
    this.emit('awareness', changes);
  }

  private clearPending(): void {
    this.pendingMessages = [];
  }

  private setStatus(status: ProviderStatus): void {
    if (this._status === status) {
      return;
    }
    this._status = status;
    this.emit('status', status);
  }

  private emit<K extends keyof EventMap>(
    event: K,
    ...payload: EventMap[K]
  ): void {
    this.listeners.get(event)?.forEach((handler) => {
      handler(...payload);
    });
  }

  private createMetadata(
    overrides?: Partial<ProtocolMessageMetadata>,
    payload?: Uint8Array,
  ): ProtocolMessageMetadata {
    const roomId = this.options.roomId ?? 'default';
    const docId = this.options.docId ?? this.doc.guid;
    const base = createMetadata(this.doc, roomId, docId, this.options.subdocId);
    const merged = {
      ...base,
      ...overrides,
    };
    if (this.metadataCustomizer) {
      return this.metadataCustomizer(merged, payload);
    }
    return merged;
  }
}
