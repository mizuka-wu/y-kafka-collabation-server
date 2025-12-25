import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Y from '@y/y';
import {
  encodeKafkaEnvelope,
  encodeSyncStep2,
  encodeUpdate,
  createMetadata,
} from '@y-kafka-collabation-server/protocol';
import {
  ProviderStatus,
  ProtocolProvider,
} from '@y-kafka-collabation-server/provider';

import { MockWebSocket } from './mock-websocket';

@Injectable()
export class DemoProviderService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoProviderService.name);
  private readonly doc = new Y.Doc();
  private readonly serverDoc = new Y.Doc();
  private readonly inboundArray = this.doc.getArray<string>('messages');
  private readonly remoteArray = this.serverDoc.getArray<string>('messages');
  private readonly provider: ProtocolProvider;
  private mockSocket?: MockWebSocket;
  private status: ProviderStatus = 'disconnected';
  private synced = false;
  private initialSyncSent = false;

  constructor() {
    MockWebSocket.onCreate = (socket) => {
      this.mockSocket = socket;
    };

    this.provider = new ProtocolProvider(this.doc, {
      url: 'mock://demo/provider',
      roomId: 'demo-room',
      autoConnect: true,
      reconnect: false,
      WebSocketImpl: MockWebSocket,
    });

    this.provider.on('status', (status) => {
      this.status = status;
      this.logger.debug(`provider status -> ${status}`);
      if (status === 'connected' && !this.initialSyncSent) {
        this.sendInitialSync();
      }
    });

    this.provider.on('sync', () => {
      this.synced = true;
      this.logger.log('provider 已同步');
    });

    this.provider.on('awareness', (changes) => {
      this.logger.debug('awareness 变更', changes);
    });
  }

  getStatus() {
    return {
      status: this.status,
      synced: this.synced,
      messages: this.inboundArray.toArray(),
    };
  }

  addLocalMessage(text: string) {
    this.inboundArray.push([text]);
    return this.getStatus();
  }

  simulateRemoteMessage(text: string) {
    this.remoteArray.push([text]);
    if (!this.mockSocket) {
      this.logger.warn('MockWebSocket 尚未建立，无法发送远端消息');
      return { success: false, reason: 'socket not ready' };
    }
    const stateVector = Y.encodeStateVector(this.doc);
    const update = Y.encodeStateAsUpdate(this.serverDoc, stateVector);
    const payload = encodeUpdate(update);
    const metadata = createMetadata(this.serverDoc, 'demo-room');
    const envelope = encodeKafkaEnvelope(payload, metadata);
    this.mockSocket.simulateServerMessage(envelope);
    return { success: true, messages: this.inboundArray.toArray() };
  }

  private sendInitialSync(): void {
    if (this.initialSyncSent || !this.mockSocket) {
      return;
    }
    this.initialSyncSent = true;
    const payload = encodeSyncStep2(this.serverDoc);
    this.sendServerEnvelope(payload);
  }

  private sendServerEnvelope(payload: Uint8Array) {
    if (!this.mockSocket) {
      this.logger.warn('MockWebSocket 不可用，无法发送 envelope');
      return;
    }
    const metadata = createMetadata(this.serverDoc, 'demo-room');
    const envelope = encodeKafkaEnvelope(payload, metadata);
    this.mockSocket.simulateServerMessage(envelope);
  }

  onModuleDestroy() {
    this.provider.destroy();
    this.doc.destroy();
    this.serverDoc.destroy();
    MockWebSocket.onCreate = undefined;
  }
}
