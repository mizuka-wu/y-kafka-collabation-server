import { decodeMetadataFromEnvelope } from '@y-kafka-collabation-server/protocol';
import {
  type CreateSocketHandlersDeps,
  type TransportSocketHandlers,
  Channel,
} from './types';
import type { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';

const resolveTopic = (
  channel: string,
  metadata: ProtocolMessageMetadata,
  resolver: CreateSocketHandlersDeps['topicResolver'],
): string | null => {
  switch (channel) {
    case Channel.Awareness: {
      if (resolver.resolveAwarenessTopic) {
        return resolver.resolveAwarenessTopic(metadata);
      }
      return null;
    }
    case Channel.Control: {
      if (resolver.resolveControlTopic) {
        return resolver.resolveControlTopic(metadata);
      }
      return null;
    }
    case Channel.Sync: {
      return resolver.resolveSyncTopic(metadata);
    }
    default: {
      return null;
    }
  }
};

export const createSocketMessageTransportHandlers = (
  deps: CreateSocketHandlersDeps,
): TransportSocketHandlers => {
  const { kafkaProducer, roomRegistry, topicResolver } = deps;

  return {
    handleConnection(socket, assignment) {
      roomRegistry.add(socket, assignment);
      socket.data.roomAssignment = assignment;
    },

    async handleClientMessage(socket, channel, message) {
      try {
        const metadata = decodeMetadataFromEnvelope(message);
        // 通过 channel 转换为 topic 让 kafka 进行消费
        const topic = resolveTopic(channel, metadata, topicResolver);
        if (topic) {
          await kafkaProducer.produce({
            topic,
            messages: [{ value: message }],
          });
        }
      } catch (e) {
        console.error(e);
      }
    },

    handleDisconnect(socket) {
      roomRegistry.remove(socket);
    },
  };
};
