import {
  Awareness,
  YDoc,
  encodeAwarenessUpdate,
  encodeStateVector,
} from 'ywasm';
import * as encoding from 'lib0/encoding';
import { ProtocolProcessing } from './processing';
import { DocState, ProtocolProviderOptions, ProviderStatus } from './types';
import { ProtocolMessageType } from '@y-kafka-collabation-server/protocol';
import { Channel } from '@y-kafka-collabation-server/transport';
import { messageYjsSyncStep1, messageYjsUpdate } from '@y/protocols/sync';

export class ProtocolManager extends ProtocolProcessing {
  // To look up state by docId (for incoming network messages)
  private docs: Map<string, DocState> = new Map();
  // To look up state by Y.Doc instance (for local updates)
  private docStates: WeakMap<YDoc, DocState> = new WeakMap();
  private _checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: ProtocolProviderOptions) {
    super(options);

    // Keep-alive / check connection
    this._checkInterval = setInterval(() => {
      if (this.socket.connected) {
        // Retry sync for any unsynced docs
        for (const state of this.docs.values()) {
          if (!state.synced) {
            // Re-trigger sync step 1
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
            encoding.writeVarUint(encoder, messageYjsSyncStep1);
            encoding.writeVarUint8Array(encoder, encodeStateVector(state.doc));
            this.send(
              Channel.Sync,
              ProtocolMessageType.Sync,
              encoding.toUint8Array(encoder),
              state.docId,
              state.parentId,
              state.offset,
            );
          }
        }
      }
    }, 30000);

    // When connected, start sync for all docs
    this.on('status', ({ status }: { status: ProviderStatus }) => {
      if (status === 'connected') {
        for (const state of this.docs.values()) {
          this.startSync(state);
        }
      } else if (status === 'disconnected') {
        for (const state of this.docs.values()) {
          state.synced = false;
          this.emit('synced', [{ docId: state.docId, state: false }]);
        }
      }
    });
  }

  destroy() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
    }
    // Cleanup all docs
    for (const state of this.docs.values()) {
      this.cleanupDocState(state);
    }
    this.docs.clear();
    super.destroy();
  }

  getDocState(docId: string): DocState | undefined {
    return this.docs.get(docId);
  }

  /**
   * Registers a Y.Doc to be managed by this provider.
   */
  addDoc(doc: YDoc, options: { docId?: string; parentId?: string } = {}) {
    if (this.docStates.has(doc)) {
      return; // Already registered
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docId = options.docId || (doc as any).guid || String(doc.id);
    const parentId = options.parentId;

    const awareness = new Awareness(doc);

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== this) {
        const state = this.docStates.get(doc);
        if (state) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
          encoding.writeVarUint(encoder, messageYjsUpdate);
          encoding.writeVarUint8Array(encoder, update);
          this.send(
            Channel.Sync,
            ProtocolMessageType.Sync,
            encoding.toUint8Array(encoder),
            state.docId,
            state.parentId,
            state.offset,
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
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, ProtocolMessageType.Awareness);
        encoding.writeVarUint8Array(
          encoder,
          encodeAwarenessUpdate(state.awareness, changedClients),
        );

        this.send(
          Channel.Awareness,
          ProtocolMessageType.Awareness,
          encoding.toUint8Array(encoder),
          state.docId,
          state.parentId,
        );
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
  removeDoc(doc: YDoc) {
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
    // Send SyncStep1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
    encoding.writeVarUint(encoder, messageYjsSyncStep1);
    encoding.writeVarUint8Array(encoder, encodeStateVector(state.doc));
    this.send(
      Channel.Sync,
      ProtocolMessageType.Sync,
      encoding.toUint8Array(encoder),
      state.docId,
      state.parentId,
      state.offset,
    );

    // Send Awareness
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const awarenessState = (state.awareness as any).getLocalState();
    if (awarenessState !== null && Object.keys(awarenessState).length > 0) {
      const awarenessUpdate = encodeAwarenessUpdate(state.awareness, [
        state.doc.id,
      ]);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, ProtocolMessageType.Awareness);
      encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
      this.send(
        Channel.Awareness,
        ProtocolMessageType.Awareness,
        encoding.toUint8Array(awarenessEncoder),
        state.docId,
        state.parentId,
      );
    }
  }
}
