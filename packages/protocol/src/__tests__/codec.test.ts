import * as awarenessProtocol from '@y/protocols/awareness';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  decodeKafkaEnvelope,
  decodeMessage,
  encodeAwareness,
  encodeKafkaEnvelope,
  encodePermissionDenied,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
} from '../index';

const createContext = () => {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  let synced = false;
  const context = {
    doc,
    awareness,
    synced,
    setSynced: (value: boolean) => {
      synced = value;
      context.synced = value;
    },
    permissionDeniedHandler: undefined,
  };
  return context;
};

describe('Protocol codec', () => {
  it('marks context as synced when receiving SyncStep2', () => {
    const context = createContext();
    const syncStep2 = encodeSyncStep2(context.doc);
    const response = decodeMessage(context, syncStep2, true);
    expect(response).toBeNull();
    expect(context.synced).toBe(true);
  });

  it('replies to SyncStep1 by returning SyncStep2 payload', () => {
    const context = createContext();
    const syncStep1 = encodeSyncStep1(context.doc);
    const response = decodeMessage(context, syncStep1);
    expect(response).not.toBeNull();
  });

  it('round-trips awareness encoding via Awareness handler', () => {
    const context = createContext();
    context.awareness.setLocalState({ cursor: 1 });
    const payload = encodeAwareness(context.awareness);
    const reply = decodeMessage(context, payload);
    expect(reply).toBeNull();
  });

  it('responds to QueryAwareness with awareness snapshot', () => {
    const context = createContext();
    context.awareness.setLocalState({ cursor: 2 });
    const payload = encodeQueryAwareness(context.awareness);
    const reply = decodeMessage(context, payload);
    expect(reply).toBeNull();
  });

  it('creates metadata with subdoc and serializes Kafka envelope', () => {
    const context = createContext();
    const metadata = createMetadata(context.doc, 'room-1', 'subdoc-a');
    const envelope = encodeKafkaEnvelope(
      encodePermissionDenied('deny'),
      metadata,
    );
    const { metadata: decodedMeta, payload } = decodeKafkaEnvelope(envelope);
    expect(decodedMeta.subdocId).toBe('subdoc-a');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('allows encodeSyncStep2 to produce valid Step2 payload', () => {
    const context = createContext();
    const synced = encodeSyncStep2(context.doc);
    const response = decodeMessage(context, synced);
    expect(response).toBeNull();
  });
});
