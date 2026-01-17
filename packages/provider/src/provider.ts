import * as Y from 'ywasm';
import { ObservableV2 } from 'lib0/observable';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { io, Socket } from 'socket.io-client';
import * as syncProtocol from '@y/protocols/sync';
import * as awarenessProtocol from '@y/protocols/awareness';
import * as authProtocol from '@y/protocols/auth';

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
  DocState,
  ProviderStatus,
} from './types';

export class ProtocolProvider extends ObservableV2<ProviderEvents> {
  public url: string;
  public roomId: string;
  public socket: Socket;

  private _status: ProviderStatus = 'disconnected';
  private _checkInterval: ReturnType<typeof setInterval> | null = null;

  // To look up state by docId (for incoming network messages)
  private docs: Map<string, DocState> = new Map();
  // To look up state by Y.Doc instance (for local updates)
  private docStates: WeakMap<Y.YDoc, DocState> = new WeakMap();

  constructor(options: ProtocolProviderOptions) {
    super();
    this.url = options.url;
    this.roomId = options.roomId;

    this.socket = io(this.url, {
      transports: ['websocket'],
      autoConnect: false,
      ...options.socketOptions,
      query: options.params,
    });

    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('disconnect', this.onDisconnect.bind(this));
    this.socket.on('connect_error', this.onConnectError.bind(this));

    // Listen to channel events
    this.socket.on(
      getSocketIOEvent(Channel.Sync),
      this.onSyncMessage.bind(this),
    );
    this.socket.on(
      getSocketIOEvent(Channel.Awareness),
      this.onAwarenessMessage.bind(this),
    );
    this.socket.on(
      getSocketIOEvent(Channel.Control),
      this.onControlMessage.bind(this),
    );

    if (options.autoConnect !== false) {
      this.connect();
    }

    // Keep-alive / check connection
    this._checkInterval = setInterval(() => {
      if (this.socket.connected) {
        // Retry sync for any unsynced docs
        for (const state of this.docs.values()) {
          if (!state.synced) {
            this.sendSyncStep1(state);
          }
        }
      }
    }, 30000);
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

    // Reset sync state
    for (const state of this.docs.values()) {
      state.synced = false;
      this.emit('synced', [{ docId: state.docId, state: false }]);
    }
  }

  destroy() {
    this.disconnect();
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
    }

    // Cleanup all docs
    for (const state of this.docs.values()) {
      this.cleanupDocState(state);
    }
    this.docs.clear();

    this.socket.off('connect', this.onConnect);
    this.socket.off('disconnect', this.onDisconnect);
    this.socket.off(getSocketIOEvent(Channel.Sync));
    this.socket.off(getSocketIOEvent(Channel.Awareness));
    this.socket.off(getSocketIOEvent(Channel.Control));

    super.destroy();
  }

  /**
   * Registers a Y.Doc to be managed by this provider.
   */
  addDoc(doc: Y.YDoc, options: { docId?: string; parentId?: string } = {}) {
    if (this.docStates.has(doc)) {
      return; // Already registered
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docId = options.docId || (doc as any).guid || String(doc.id);
    const parentId = options.parentId;

    const awareness = new Y.Awareness(doc);

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== this) {
        const state = this.docStates.get(doc);
        if (state) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
          encoding.writeVarUint8Array(encoder, update);
          this.send(
            state,
            Channel.Sync,
            ProtocolMessageType.Sync,
            encoding.toUint8Array(encoder),
          );
        }
      }
    };

    const awarenessUpdateHandler = (
      {
        added,
        updated,
        removed,
      }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === this) return;
      const state = this.docStates.get(doc);
      if (state) {
        const changedClients = added.concat(updated).concat(removed);
        const update = Y.encodeAwarenessUpdate(state.awareness, changedClients);
        this.sendAwareness(state, update);
      }
    };

    const state: DocState = {
      doc,
      docId,
      parentId,
      synced: false,
      awareness,
      updateHandler,
      awarenessUpdateHandler,
    };

    this.docs.set(docId, state);
    this.docStates.set(doc, state);

    doc.on('update', updateHandler);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (awareness as any).on('update', awarenessUpdateHandler);

    this.emit('doc-loaded', [docId]);

    // If connected, start sync
    if (this.socket.connected) {
      this.startSync(state);
    }
  }

  /**
   * Unregisters a Y.Doc.
   */
  removeDoc(doc: Y.YDoc) {
    const state = this.docStates.get(doc);
    if (state) {
      this.cleanupDocState(state);
      this.docs.delete(state.docId);
      this.docStates.delete(doc);
    }
  }

  private cleanupDocState(state: DocState) {
    try {
      state.doc.off('update', state.updateHandler);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state.awareness as any).off('update', state.awarenessUpdateHandler);
    } catch {
      // ignore
    }
  }

  private startSync(state: DocState) {
    this.sendSyncStep1(state);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const awarenessState = (state.awareness as any).getLocalState();
    if (awarenessState !== null && Object.keys(awarenessState).length > 0) {
      const awarenessUpdate = Y.encodeAwarenessUpdate(state.awareness, [
        state.doc.id,
      ]);
      this.sendAwareness(state, awarenessUpdate);
    }
  }

  // --- Socket Event Handlers ---

  private onConnect() {
    this._status = 'connected';
    this.emit('status', [{ status: 'connected' }]);

    // Sync all docs
    for (const state of this.docs.values()) {
      this.startSync(state);
    }
  }

  private onDisconnect(reason: Socket.DisconnectReason) {
    this._status = 'disconnected';
    this.emit('status', [{ status: 'disconnected' }]);
    for (const state of this.docs.values()) {
      state.synced = false;
      this.emit('synced', [{ docId: state.docId, state: false }]);
    }
    this.emit('connection-close', [reason]);
  }

  private onConnectError(error: Error) {
    this.emit('connection-error', [error]);
  }

  // --- Message Processing ---

  private createMetadata(state: DocState): ProtocolMessageMetadata {
    return {
      roomId: this.roomId,
      docId: state.docId,
      parentId: state.parentId,
      senderId: String(state.doc.id),
      timestamp: Date.now(),
    };
  }

  private send(
    state: DocState,
    channel: Channel,
    messageType: ProtocolMessageType,
    payload: Uint8Array,
  ) {
    if (!this.socket.connected) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageType);
    encoding.writeUint8Array(encoder, payload);
    const content = encoding.toUint8Array(encoder);

    const metadata = this.createMetadata(state);
    const envelope = encodeEnvelope(content, metadata);
    this.socket.emit(getSocketIOEvent(channel), envelope);
  }

  private sendSyncStep1(state: DocState) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep1);
    const sv = Y.encodeStateVector(state.doc);
    encoding.writeVarUint8Array(encoder, sv);
    this.send(
      state,
      Channel.Sync,
      ProtocolMessageType.Sync,
      encoding.toUint8Array(encoder),
    );
  }

  private sendSyncStep2(state: DocState, targetStateVector: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
    const update = Y.encodeStateAsUpdate(state.doc, targetStateVector);
    encoding.writeVarUint8Array(encoder, update);
    this.send(
      state,
      Channel.Sync,
      ProtocolMessageType.Sync,
      encoding.toUint8Array(encoder),
    );
  }

  private sendAwareness(state: DocState, update: Uint8Array) {
    this.send(state, Channel.Awareness, ProtocolMessageType.Awareness, update);
  }

  private processIncomingMessage(
    payload: unknown,
    handler: (
      state: DocState,
      messageType: number,
      payload: Uint8Array,
    ) => void,
  ) {
    let buffer: Uint8Array;
    let offset: string | undefined;

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
        offset = p.offset;
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

      const state = this.docs.get(metadata.docId);
      if (!state) {
        // Doc not managed by this provider
        return;
      }

      if (offset) {
        state.offset = offset;
      }

      const decoder = decoding.createDecoder(content);
      const messageType = decoding.readVarUint(decoder);
      const messagePayload = decoding.readUint8Array(
        decoder,
        content.byteLength - decoder.pos,
      );

      handler(state, messageType, messagePayload);
    } catch (e) {
      console.error('Failed to process incoming message', e);
    }
  }

  private onSyncMessage(payload: unknown) {
    this.processIncomingMessage(payload, (state, type, content) => {
      if (type === ProtocolMessageType.Sync) {
        const decoder = decoding.createDecoder(content);
        const syncMessageType = decoding.readVarUint(decoder);

        switch (syncMessageType) {
          case syncProtocol.messageYjsSyncStep1: {
            const sv = decoding.readVarUint8Array(decoder);
            this.sendSyncStep2(state, sv);
            break;
          }
          case syncProtocol.messageYjsSyncStep2: {
            const update = decoding.readVarUint8Array(decoder);
            Y.applyUpdate(state.doc, update, this);
            if (!state.synced) {
              state.synced = true;
              this.emit('synced', [{ docId: state.docId, state: true }]);
            }
            break;
          }
        }
      }
    });
  }

  private onAwarenessMessage(payload: unknown) {
    this.processIncomingMessage(payload, (state, type, content) => {
      if (type === ProtocolMessageType.Awareness) {
        const decoder = decoding.createDecoder(content);
        const update = decoding.readVarUint8Array(decoder);
        Y.applyAwarenessUpdate(state.awareness, update, this);
      }
    });
  }

  private onControlMessage(payload: unknown) {
    this.processIncomingMessage(payload, (state, type, content) => {
      this.emit('control', [type, content]);
      if (type === ProtocolMessageType.Auth) {
        const decoder = decoding.createDecoder(content);
        const authMessageType = decoding.readVarUint(decoder);
        if (authMessageType === authProtocol.messagePermissionDenied) {
          const reason = decoding.readVarString(decoder);
          this.emit('permission-denied', [reason]);
        }
      }
    });
  }
}
