import { decodeMetadataFromEnvelope } from '@y-kafka-collabation-server/protocol';
import {
  type CreateSocketHandlersDeps,
  type TransportSocketHandlers,
  Channel,
  SOCKET_IO_EVENT_PREFIX,
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

        // Special handling for Awareness if a custom handler is provided (e.g. Redis broadcast)
        if (channel === Channel.Awareness && deps.onAwarenessUpdate) {
          await deps.onAwarenessUpdate(socket, metadata, message);
          return;
        }

        // 通过 channel 转换为 topic 让 kafka 进行消费
        const topic = resolveTopic(channel, metadata, topicResolver);
        if (topic) {
          await kafkaProducer.produce({
            topic,
            messages: [
              {
                value: message,
                // Use docId (or roomId) as partition key to ensure ordering
                key: metadata.docId || metadata.roomId,
              },
            ],
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

export function getSocketIOEvent(channel: string) {
  return `${SOCKET_IO_EVENT_PREFIX}-${channel}`;
}

export function getChannelFromSocketIOEvent(
  socketIOEvent: string,
): Channel | null {
  const channel = socketIOEvent.replace(
    `${SOCKET_IO_EVENT_PREFIX}-`,
    '',
  ) as Channel;
  if (Object.values(Channel).includes(channel)) {
    return channel;
  }
  return null;
}
