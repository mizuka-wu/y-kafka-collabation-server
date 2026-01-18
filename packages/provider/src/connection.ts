import { ObservableV2 } from 'lib0/observable';
import { io, Socket } from 'socket.io-client';
import * as encoding from 'lib0/encoding';
import {
  encodeEnvelope,
  decodeEnvelope,
  ProtocolMessageType,
  ProtocolMessageMetadata,
} from '@y-kafka-collabation-server/protocol';
import {
  getSocketIOEvent,
  Channel,
} from '@y-kafka-collabation-server/transport';
import {
  ProtocolProviderOptions,
  ProviderEvents,
  ProviderStatus,
} from './types';

export class ProtocolConnection extends ObservableV2<ProviderEvents> {
  public url: string;
  public roomId: string;
  public socket: Socket;
  private _status: ProviderStatus = 'disconnected';

  constructor(options: ProtocolProviderOptions) {
    super();
    this.url = options.url;
    this.roomId = options.roomId;

    this.socket = io(this.url, {
      autoConnect: false,
      ...options.socketOptions,
      query: options.params,
    });

    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('disconnect', this.onDisconnect.bind(this));
    this.socket.on('connect_error', this.onConnectError.bind(this));

    // Listen to channel events
    this.socket.on(getSocketIOEvent(Channel.Sync), (data, offset) =>
      this.handleIncomingMessage(Channel.Sync, data, offset),
    );
    this.socket.on(getSocketIOEvent(Channel.Awareness), (data) =>
      this.handleIncomingMessage(Channel.Awareness, data),
    );
    this.socket.on(getSocketIOEvent(Channel.Control), (data) =>
      this.handleIncomingMessage(Channel.Control, data),
    );

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  get status() {
    return this._status;
  }

  connect() {
    if (!this.socket.connected) {
      this._status = 'connecting';
      this.emit('status', [{ status: 'connecting' }]);
      this.socket.connect();
    } else {
      this.onConnect();
    }
  }

  disconnect() {
    if (this.socket.connected) {
      this.socket.disconnect();
    }
    this._status = 'disconnected';
    this.emit('status', [{ status: 'disconnected' }]);
  }

  destroy() {
    this.disconnect();
    this.socket.removeAllListeners();
    super.destroy();
  }

  /**
   * Send a message to the server
   */
  public send(
    channel: Channel,
    messageType: ProtocolMessageType,
    payload: Uint8Array,
    docId: string,
    parentId?: string,
    offset?: string, // Kafka offset for sync messages
  ) {
    if (!this.socket.connected) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageType);
    encoding.writeUint8Array(encoder, payload);
    const content = encoding.toUint8Array(encoder);

    const metadata: ProtocolMessageMetadata = {
      roomId: this.roomId,
      docId,
      parentId,
      senderId: this.socket.id || 'unknown',
      timestamp: Date.now(),
    };

    const envelope = encodeEnvelope(content, metadata);
    if (channel === Channel.Sync && offset !== undefined) {
      this.socket.emit(getSocketIOEvent(channel), envelope, offset);
    } else {
      this.socket.emit(getSocketIOEvent(channel), envelope);
    }
  }

  private onConnect() {
    this._status = 'connected';
    this.emit('status', [{ status: 'connected' }]);
  }

  private onDisconnect(reason: Socket.DisconnectReason) {
    this._status = 'disconnected';
    this.emit('status', [{ status: 'disconnected' }]);
    this.emit('connection-close', [reason]);
  }

  private onConnectError(error: Error) {
    this.emit('connection-error', [error]);
  }

  private handleIncomingMessage(
    channel: Channel,
    payload: unknown,
    incomingOffset?: string,
  ) {
    let buffer: Uint8Array;
    let offset: string | undefined = incomingOffset;

    // Buffer conversion logic
    if (
      payload instanceof Uint8Array ||
      payload instanceof ArrayBuffer ||
      (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload))
    ) {
      buffer = new Uint8Array(payload as ArrayBuffer | SharedArrayBuffer);
    } else if (payload && typeof payload === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = payload as any;
      if (
        'message' in p &&
        (p.message instanceof Uint8Array ||
          p.message instanceof ArrayBuffer ||
          (typeof Buffer !== 'undefined' && Buffer.isBuffer(p.message)))
      ) {
        buffer = new Uint8Array(p.message);
        // Fallback if offset is inside object
        if (!offset && typeof p.offset === 'string') {
          offset = p.offset;
        }
      } else {
        console.warn('Received unknown payload object', payload);
        return;
      }
    } else {
      console.warn('Received unknown payload type', payload);
      return;
    }

    try {
      const { metadata, payload: content } = decodeEnvelope(buffer);

      switch (channel) {
        case Channel.Sync:
          this.emit('message-sync', [content, metadata, offset]);
          break;
        case Channel.Awareness:
          this.emit('message-awareness', [content, metadata, offset]);
          break;
        case Channel.Control:
          this.emit('message-control', [content, metadata, offset]);
          break;
      }
    } catch (e) {
      console.error('Failed to process incoming message', e);
    }
  }
}
