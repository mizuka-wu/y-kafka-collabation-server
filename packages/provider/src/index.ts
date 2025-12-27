import * as Y from '@y/y';
import * as awarenessProtocol from '@y/protocols/awareness';
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
export {
  MultiplexedSocketManager,
  createVirtualWebSocketFactory,
  VirtualWebSocket,
} from './socket-io-multiplexer';

type AwarenessChangePayload = {
  readonly added: number[];
  readonly updated: number[];
  readonly removed: number[];
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
   * WebSocket 地址，协议端点必须返回 `Kafka envelope + metadata` 的二进制帧。
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
   * 用于替换浏览器内置 WebSocket（例如 Node.js polyfill）。
   */
  WebSocketImpl?: typeof WebSocket;
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

const textEncoder = new TextEncoder();

export class ProtocolProvider implements ProtocolCodecContext {
  public readonly doc: Y.Doc;
  public readonly awareness: awarenessProtocol.Awareness;
  public synced = false;
  public permissionDeniedHandler?: (reason: string) => void;

  private readonly options: ProtocolProviderOptions;
  private readonly metadataCustomizer?: ProtocolProviderOptions['metadataCustomizer'];
  private readonly WebSocketImpl?: typeof WebSocket;
  private ws?: WebSocket;
  private readonly listeners = new Map<
    ProtocolProviderEvent,
    Set<(...args: unknown[]) => void>
  >();
  private pendingMessages: PendingMessage[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private manualDisconnect = false;
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

    this.WebSocketImpl =
      this.options.WebSocketImpl ??
      (typeof WebSocket !== 'undefined' ? WebSocket : undefined);

    if (!this.WebSocketImpl) {
      throw new Error(
        'WebSocket 未找到，请传入 Polyfill 作为 ProtocolProviderOptions.WebSocketImpl',
      );
    }

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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    this.manualDisconnect = false;
    this.clearReconnectTimer();
    this.createWebSocket();
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.closeWebSocket();
    this.clearPending();
    this.setStatus('disconnected');
  }

  public destroy(): void {
    this.disconnect();
    this.doc.off('update', this.docUpdateListener);
    this.awareness.off('update', this.awarenessListener);
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

  private get shouldReconnect(): boolean {
    if (!this.options.reconnect) {
      return false;
    }
    if (typeof this.options.maxReconnectAttempts === 'number') {
      return this.reconnectAttempts < this.options.maxReconnectAttempts;
    }
    return true;
  }

  private createWebSocket(): void {
    this.setStatus('connecting');
    this.reconnectAttempts = 0;
    if (!this.WebSocketImpl) {
      throw new Error('WebSocket implementation missing');
    }
    const ws = new this.WebSocketImpl(this.options.url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.ws = ws;
      this.setStatus('connected');
      this.flushPending();
      this.sendSyncStep1();
    };

    ws.onmessage = (event) => {
      void this.handleIncomingMessage(event.data);
    };

    ws.onclose = () => {
      this.ws = undefined;
      this.setStatus('disconnected');
      if (!this.manualDisconnect && this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = (event) => {
      this.emit('error', event);
    };
  }

  private closeWebSocket(): void {
    if (!this.ws) {
      return;
    }
    this.ws.close();
    this.ws = undefined;
  }

  private handleIncomingMessage(
    data: string | ArrayBuffer | ArrayBufferView | Blob,
  ): Promise<void> {
    return new Promise((resolve) => {
      const payloadPromise =
        data instanceof ArrayBuffer
          ? Promise.resolve(new Uint8Array(data))
          : data instanceof Uint8Array
            ? Promise.resolve(data)
            : data instanceof Blob
              ? data.arrayBuffer().then((buffer) => new Uint8Array(buffer))
              : Promise.resolve(textEncoder.encode(data.toString()));

      payloadPromise
        .then((buffer) => {
          const { metadata, payload: remotePayload } =
            decodeKafkaEnvelope(buffer);
          const reply = decodeMessage(this, remotePayload, true);
          if (reply) {
            this.queueMessage(reply, {
              roomId: metadata.roomId,
              docId: metadata.docId,
              subdocId: metadata.subdocId,
              version: metadata.version,
            });
          }
        })
        .catch((error) => {
          this.emit('error', error);
        })
        .finally(() => resolve());
    });
  }

  private queueMessage(
    payload: Uint8Array,
    overrides?: Partial<ProtocolMessageMetadata>,
  ): void {
    this.pendingMessages.push({ payload, metadataOverrides: overrides });
    this.flushPending();
  }

  private flushPending(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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
      this.ws.send(envelope);
    }
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

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }
    const base = this.options.reconnectInterval ?? 500;
    const max = this.options.reconnectMaxInterval ?? 10000;
    const interval = Math.min(
      max,
      base * Math.pow(1.5, this.reconnectAttempts),
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.createWebSocket();
    }, interval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
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
