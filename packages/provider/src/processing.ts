import { applyAwarenessUpdate, applyUpdate, encodeStateAsUpdate } from 'ywasm';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as authProtocol from '@y/protocols/auth';
import { ProtocolConnection } from './connection';
import { DocState, ProtocolProviderOptions } from './types';
import {
  ProtocolMessageType,
  ProtocolMessageMetadata,
} from '@y-kafka-collabation-server/protocol';
import { Channel } from '@y-kafka-collabation-server/transport';
import { SyncStep1, SyncStep2, SyncUpdate } from './constants';

export abstract class ProtocolProcessing extends ProtocolConnection {
  constructor(options: ProtocolProviderOptions) {
    super(options);

    this.on(
      'message-sync',
      (
        payload: Uint8Array,
        metadata: ProtocolMessageMetadata,
        offset?: string,
      ) => {
        this.handleSyncMessage(payload, metadata, offset);
      },
    );
    this.on(
      'message-awareness',
      (
        payload: Uint8Array,
        metadata: ProtocolMessageMetadata,
        offset?: string,
      ) => {
        this.handleAwarenessMessage(payload, metadata, offset);
      },
    );
    this.on(
      'message-auth',
      (
        payload: Uint8Array,
        metadata: ProtocolMessageMetadata,
        offset?: string,
      ) => {
        this.handleAuthMessage(payload, metadata, offset);
      },
    );
    this.on(
      'message-control',
      (
        payload: Uint8Array,
        metadata: ProtocolMessageMetadata,
        offset?: string,
      ) => {
        this.handleControlMessage(payload, metadata, offset);
      },
    );
  }

  abstract getDocState(docId: string): DocState | undefined;

  private handleSyncMessage(
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
    offset?: string,
  ) {
    const state = this.getDocState(metadata.docId);
    if (!state) return;

    if (offset) {
      state.offset = offset;
    }

    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();

    // Read the outer message type
    const messageType = decoding.readVarUint(decoder);

    if (messageType === ProtocolMessageType.Sync) {
      encoding.writeVarUint(encoder, ProtocolMessageType.Sync);

      const syncMessageType = decoding.readVarUint(decoder);
      switch (syncMessageType) {
        case SyncStep1: {
          const stateVector = decoding.readVarUint8Array(decoder);
          const update = encodeStateAsUpdate(state.doc, stateVector);
          encoding.writeVarUint(encoder, SyncStep2);
          encoding.writeVarUint8Array(encoder, update);
          break;
        }
        case SyncStep2: {
          const update = decoding.readVarUint8Array(decoder);
          applyUpdate(state.doc, update, this);
          if (!state.synced) {
            state.synced = true;
            this.emit('synced', [{ docId: state.docId, state: true }]);
          }
          break;
        }
        case SyncUpdate: {
          const update = decoding.readVarUint8Array(decoder);
          applyUpdate(state.doc, update, this);
          break;
        }
      }
    }

    if (encoding.length(encoder) > 1) {
      this.send(
        Channel.Sync,
        ProtocolMessageType.Sync,
        encoding.toUint8Array(encoder),
        state.docId,
        state.parentId,
      );
    }
  }

  private handleAwarenessMessage(
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
    offset?: string,
  ) {
    const state = this.getDocState(metadata.docId);
    if (!state) return;

    if (offset) {
      state.offset = offset;
    }

    const decoder = decoding.createDecoder(payload);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === ProtocolMessageType.Awareness) {
      const update = decoding.readVarUint8Array(decoder);
      applyAwarenessUpdate(state.awareness, update, this);
    }
  }

  private handleAuthMessage(
    payload: Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _metadata: ProtocolMessageMetadata,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _offset?: string,
  ) {
    const decoder = decoding.createDecoder(payload);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === ProtocolMessageType.Auth) {
      const authMessageType = decoding.readVarUint(decoder);
      if (authMessageType === authProtocol.messagePermissionDenied) {
        const reason = decoding.readVarString(decoder);
        this.emit('permission-denied', [reason]);
      }
    }
  }

  private handleControlMessage(
    payload: Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _metadata: ProtocolMessageMetadata,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _offset?: string,
  ) {
    const decoder = decoding.createDecoder(payload);
    const messageType = decoding.readVarUint(decoder);
    this.emit('control', [messageType, payload]);
  }
}
