import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Buffer } from 'buffer';
import { decodeKafkaEnvelope } from '@y-kafka-collabation-server/protocol';
import type { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';
import { CollabChannel, ServerCollabService } from './server-collab.service';

type ProtocolPayload =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Uint8Array
  | Buffer;

type ClientProtocolMessage = {
  roomId?: string;
  docId: string;
  channel?: CollabChannel;
  payload: ProtocolPayload;
};

type TransportProtocolMessage = {
  metadata: ProtocolMessageMetadata;
  payload: ProtocolPayload;
  topic?: string;
  partition?: number;
  offset?: string;
  roomId?: string;
  docId?: string;
};

type GatewayProtocolMessage = ClientProtocolMessage & TransportProtocolMessage;

const toUint8Array = (payload: ProtocolPayload): Uint8Array => {
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
    return new Uint8Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    );
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    );
  }
  if (typeof payload === 'string') {
    return Buffer.from(payload, 'base64');
  }
  throw new Error('Unsupported protocol payload type');
};

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ServerCollabGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: SocketIOServer;

  private readonly logger = new Logger(ServerCollabGateway.name);
  private readonly rooms = new Map<string, Set<Socket>>();

  constructor(private readonly collabService: ServerCollabService) {}

  afterInit() {
    this.collabService.registerUpdateListener((metadata, payload) => {
      const docId = metadata.docId;
      if (!docId) {
        return;
      }
      const sockets = this.rooms.get(docId);
      if (!sockets) {
        return;
      }
      for (const socket of sockets) {
        socket.emit('protocol-message', {
          metadata,
          payload,
        });
      }
    });
    this.logger.log('Gateway initialized and listening for Kafka updates');
  }

  handleConnection(client: Socket) {
    const docId = this.extractRoomFromQuery(client);
    if (docId) {
      this.addSocketToRoom(docId, client);
      client.emit('joined', { docId });
      this.logger.log(`Socket ${client.id} auto-joined room ${docId}`);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [docId, sockets] of this.rooms) {
      if (sockets.delete(client)) {
        this.logger.debug(`Socket ${client.id} left room ${docId}`);
        if (!sockets.size) {
          this.rooms.delete(docId);
        }
      }
    }
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { docId: string },
  ) {
    this.addSocketToRoom(payload.docId, client);
    this.logger.log(`Socket ${client.id} joined ${payload.docId}`);
    client.emit('joined', { docId: payload.docId });
  }

  @SubscribeMessage('protocol-message')
  async handleProtocolMessage(
    @ConnectedSocket() _client: Socket,
    @MessageBody() message: GatewayProtocolMessage,
  ) {
    const docId = message.docId;
    const roomId = message.roomId ?? 'default';
    const channel = (message.channel as CollabChannel | undefined) ?? 'doc';
    const payload = message.payload;
    if (!docId) {
      throw new Error('protocol-message missing docId');
    }
    const buffer = toUint8Array(payload);

    try {
      const { metadata: envelopeMeta } = decodeKafkaEnvelope(buffer);
      if (envelopeMeta.note === 'sync-request') {
        await this.respondWithDocumentState(_client, docId);
        return;
      }
    } catch (error) {
      this.logger.error(
        `Failed to decode envelope for ${docId}, forwarding raw payload`,
        error as Error,
      );
    }

    return this.collabService.publishUpdate({
      roomId,
      docId,
      channel,
      content: buffer,
    });
  }

  private addSocketToRoom(docId: string, socket: Socket) {
    const set = this.rooms.get(docId) ?? new Set<Socket>();
    set.add(socket);
    this.rooms.set(docId, set);
  }

  private extractRoomFromQuery(client: Socket): string | undefined {
    const roomParam = client.handshake.query.room;
    if (!roomParam) {
      return undefined;
    }
    if (Array.isArray(roomParam)) {
      return roomParam[0];
    }
    return roomParam as string;
  }

  private async respondWithDocumentState(client: Socket, docId: string) {
    const state = await this.collabService.getDocumentState(docId);
    const payloads: Uint8Array[] = [];

    if (state.snapshot) {
      payloads.push(this.base64ToUint8Array(state.snapshot));
    }
    for (const update of state.updates) {
      payloads.push(this.base64ToUint8Array(update));
    }

    if (!payloads.length) {
      this.logger.warn(`No snapshot or updates available for ${docId}`);
      return;
    }

    for (const payload of payloads) {
      client.emit('protocol-message', {
        docId,
        payload,
      });
    }
    this.logger.log(
      `Replayed ${payloads.length} historical payload(s) for ${docId} to ${client.id}`,
    );
  }

  private base64ToUint8Array(input: string): Uint8Array {
    const binary = Buffer.from(input, 'base64');
    return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
  }
}
