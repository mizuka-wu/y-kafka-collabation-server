import {
  ProtocolMessageEventName,
  decodeMetadataFromMessage,
  type ProtocolMessageEventPayload,
} from '@y-kafka-collabation-server/protocol';
import type {
  KafkaMessage,
  StartKafkaConsumerDeps,
  TopicResolver,
} from './types';

const toUint8Array = (data: Uint8Array | Buffer): Uint8Array => {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
};

function getTopicsFromRoomId(roomId: string, topicResolver: TopicResolver) {
  const topics = [
    topicResolver.resolveSyncTopic(roomId),
    topicResolver.resolveAwarenessTopic(roomId),
  ];
  if (topicResolver.resolveControlTopic) {
    topics.push(topicResolver.resolveControlTopic(roomId));
  }
  return topics;
}

/**
 * 开始消费 Kafka 消息。
 * @param {StartKafkaConsumerDeps}
 */
export const startKafkaConsumer = async (deps: StartKafkaConsumerDeps) => {
  const { kafkaConsumer, roomRegistry, topicResolver } = deps;

  /**
   * 初始化的
   */
  const initialTopics = Array.from(
    new Set(
      roomRegistry
        .getRooms()
        .flatMap((roomId) => getTopicsFromRoomId(roomId, topicResolver)),
    ),
  );
  for (const topic of initialTopics) {
    await kafkaConsumer.subscribe(topic);
  }

  await kafkaConsumer.run({
    autoCommit: true,
    restartOnFailure: async (err) => {
      console.error('Kafka consumer error, restarting...', err);
      return true;
    },
    eachMessage: async (message: KafkaMessage) => {
      if (!message.value) {
        return;
      }
      try {
        const metadata = decodeMetadataFromMessage(toUint8Array(message.value));

        const { roomId, docId, subdocId } = metadata;

        if (!roomId || !docId) {
          console.warn('Kafka message missing roomId/docId metadata', {
            topic: message.topic,
            metadata,
          });
          return;
        }

        const sockets = roomRegistry.getSockets(roomId, docId, subdocId);
        if (sockets.length === 0) {
          return;
        }

        const eventPayload: ProtocolMessageEventPayload = {
          topic: message.topic,
          partition: message.partition,
          offset: message.offset,
          message: message.value,
        };

        sockets.forEach((socket) => {
          socket.emit(ProtocolMessageEventName, eventPayload);
        });
      } catch (e) {
        console.error(e);
      }
    },
  });
};
