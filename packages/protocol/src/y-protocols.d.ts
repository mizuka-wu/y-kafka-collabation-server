type ObservableListener = (...args: unknown[]) => void;

interface ObservableLike {
  on(eventName: string, callback: ObservableListener): void;
  off(eventName: string, callback: ObservableListener): void;
  emit(eventName: string, args: unknown[]): void;
  destroy(): void;
}

declare module '@y/protocols/auth' {
  import type * as encoding from 'lib0/encoding';
  import type * as decoding from 'lib0/decoding';
  import type * as Y from '@y/y';

  export const messagePermissionDenied: 0;

  export type PermissionDeniedHandler = (y: Y.Doc, reason: string) => void;

  export function writePermissionDenied(
    encoder: encoding.Encoder,
    reason: string,
  ): void;

  export function readAuthMessage(
    decoder: decoding.Decoder,
    y: Y.Doc,
    permissionDeniedHandler: PermissionDeniedHandler,
  ): void;
}

declare module '@y/protocols/awareness' {
  import type * as Y from '@y/y';

  export const outdatedTimeout: number;

  export interface MetaClientState {
    clock: number;
    lastUpdated: number;
  }

  export class Awareness implements ObservableLike {
    constructor(doc: Y.Doc);
    doc: Y.Doc;
    clientID: number;
    states: Map<number, Record<string, unknown>>;
    meta: Map<number, MetaClientState>;
    getLocalState(): Record<string, unknown> | null;
    setLocalState(state: Record<string, unknown> | null): void;
    setLocalStateField(field: string, value: unknown): void;
    getStates(): Map<number, Record<string, unknown>>;
    on(
      eventName: 'change' | 'update' | 'destroy',
      cb: ObservableListener,
    ): void;
    off(
      eventName: 'change' | 'update' | 'destroy',
      cb: ObservableListener,
    ): void;
    emit(eventName: 'change' | 'update' | 'destroy', args: unknown[]): void;
    destroy(): void;
  }

  export function removeAwarenessStates(
    awareness: Awareness,
    clients: number[],
    origin: unknown,
  ): void;

  export function encodeAwarenessUpdate(
    awareness: Awareness,
    clients: number[],
    states?: Map<number, Record<string, unknown>>,
  ): Uint8Array;

  export function modifyAwarenessUpdate(
    update: Uint8Array,
    modify: (state: unknown) => unknown,
  ): Uint8Array;

  export function applyAwarenessUpdate(
    awareness: Awareness,
    update: Uint8Array,
    origin: unknown,
  ): void;
}

declare module '@y/protocols/sync' {
  import type * as encoding from 'lib0/encoding';
  import type * as decoding from 'lib0/decoding';
  import type * as Y from '@y/y';

  export type StateMap = Map<number, number>;

  export const messageYjsSyncStep1: 0;
  export const messageYjsSyncStep2: 1;
  export const messageYjsUpdate: 2;

  export function writeSyncStep1(encoder: encoding.Encoder, doc: Y.Doc): void;

  export function writeSyncStep2(
    encoder: encoding.Encoder,
    doc: Y.Doc,
    encodedStateVector?: Uint8Array,
  ): void;

  export function readSyncStep1(
    decoder: decoding.Decoder,
    encoder: encoding.Encoder,
    doc: Y.Doc,
  ): void;

  export function readSyncStep2(
    decoder: decoding.Decoder,
    doc: Y.Doc,
    transactionOrigin: unknown,
  ): void;

  export function writeUpdate(
    encoder: encoding.Encoder,
    update: Uint8Array,
  ): void;

  export const readUpdate: typeof readSyncStep2;

  export function readSyncMessage(
    decoder: decoding.Decoder,
    encoder: encoding.Encoder,
    doc: Y.Doc,
    transactionOrigin: unknown,
  ): number;
}

declare module '@y/protocols/auth.js' {
  export * from '@y/protocols/auth';
}

declare module '@y/protocols/awareness.js' {
  export * from '@y/protocols/awareness';
}

declare module '@y/protocols/sync.js' {
  export * from '@y/protocols/sync';
}
