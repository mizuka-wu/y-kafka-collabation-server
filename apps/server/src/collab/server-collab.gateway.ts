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

import { ServerCollabService } from './server-collab.service';

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
    this.collabService.registerUpdateListener((docId, payload) => {
      const sockets = this.rooms.get(docId);
      if (!sockets) {
        return;
      }
      for (const socket of sockets) {
        socket.emit('protocol-message', { docId, payload });
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
  async handleProtocolMessage(message: { docId: string; payload: string }) {
    return this.collabService.publishUpdate(message.docId, message.payload);
  }

  private addSocketToRoom(docId: string, socket: Socket) {
    const set = this.rooms.get(docId) ?? new Set<Socket>();
    set.add(socket);
    this.rooms.set(docId, set);
  }

  private extractRoomFromQuery(client: Socket) {
    const roomParam = client.handshake.query.room;
    if (!roomParam) {
      return undefined;
    }
    if (Array.isArray(roomParam)) {
      return roomParam[0];
    }
    if (typeof roomParam === 'string') {
      return roomParam;
    }
    return undefined;
  }
}
