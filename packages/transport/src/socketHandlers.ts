import { Socket } from 'socket.io';
import {
  BusClientMessage,
  CreateBusSocketHandlersDeps,
  RoomAssignment,
} from './types';

const textEncoder = new TextEncoder();

const toUint8Array = (payload: Uint8Array | Buffer | string): Uint8Array => {
  if (typeof payload === 'string') {
    return textEncoder.encode(payload);
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  return new Uint8Array(payload);
};

const resolveTopic = (
  channel: string | undefined,
  roomId: string,
  resolver: CreateBusSocketHandlersDeps['topicResolver'],
): string => {
  if (channel === 'awareness') {
    return resolver.resolveAwarenessTopic(roomId);
  }
  if (channel === 'control' && resolver.resolveControlTopic) {
    return resolver.resolveControlTopic(roomId);
  }
  return resolver.resolveSyncTopic(roomId);
};

export const createBusSocketHandlers = (
  deps: CreateBusSocketHandlersDeps,
): {
  handleConnection: (socket: Socket, assignment: RoomAssignment) => void;
  handleClientMessage: (
    socket: Socket,
    message: BusClientMessage,
  ) => Promise<void>;
  handleDisconnect: (socket: Socket) => void;
} => {
  const { kafkaProducer, protocolCodec, roomRegistry, topicResolver } = deps;

  return {
    handleConnection(socket, assignment) {
      roomRegistry.add(socket, assignment);
      socket.data.roomAssignment = assignment;
    },

    async handleClientMessage(socket, message) {
      const metadata = message.metadata;

      const topic = resolveTopic(
        message.channel,
        metadata.roomId as string,
        topicResolver,
      );
      const payload = toUint8Array(message.payload);
      const envelope = protocolCodec.encodeKafkaEnvelope(payload, metadata);
      await kafkaProducer.produce({
        topic,
        messages: [{ value: envelope }],
      });
    },

    handleDisconnect(socket) {
      roomRegistry.remove(socket);
    },
  };
};
