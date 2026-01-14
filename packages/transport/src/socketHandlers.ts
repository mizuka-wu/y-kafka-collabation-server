import { decodeMetadataFromEnvelope, decodeEnvelope } from '@y-kafka-collabation-server/protocol';
import {
  type CreateSocketHandlersDeps,
  type RoomAssignment,
  Channel,
} from './types';
import type { Socket } from 'socket.io';
import type { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';

const resolveTopic = (
  channel: string | undefined,
  metadata: ProtocolMessageMetadata,
  resolver: CreateSocketHandlersDeps['topicResolver'],
): string => {
  if (channel === Channel.Awareness) {
    return resolver.resolveAwarenessTopic(metadata);
  }
  if (channel === Channel.Control && resolver.resolveControlTopic) {
    return resolver.resolveControlTopic(metadata);
  }
  return resolver.resolveSyncTopic(metadata);
};

export const createSocketMessageTransportHandlers = (
  deps: CreateSocketHandlersDeps,
): {
  handleConnection: (socket: Socket, assignment: RoomAssignment) => void;
  handleClientMessage: (socket: Socket, message: Uint8Array) => Promise<void>;
  handleDisconnect: (socket: Socket) => void;
} => {
  const { kafkaProducer, roomRegistry, topicResolver } = deps;

  return {
    handleConnection(socket, assignment) {
      roomRegistry.add(socket, assignment);
      socket.data.roomAssignment = assignment;
    },

    async handleClientMessage(socket, message) {
      try {
        const metadata = decodeMetadataFromEnvelope(message);
        const me = 

        /**
         * 根据消息类型决定 channel
         */
        const topic = resolveTopic(message.channel, metadata, topicResolver);
        await kafkaProducer.produce({
          topic,
          messages: [{ value: message }],
        });
      } catch (e) {
        console.error(e);
      }
    },

    handleDisconnect(socket) {
      roomRegistry.remove(socket);
    },
  };
};
