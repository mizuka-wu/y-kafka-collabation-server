import {
  ProtocolMessageEventName,
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
  const {
    kafkaConsumer,
    roomRegistry,
    protocolCodec,
    onMessageEvent = ProtocolMessageEventName,
    onMessageProcessed,
    topicResolver,
  } = deps;

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
      let metadata;
      let payload;
      try {
        ({ metadata, payload } = protocolCodec.decodeKafkaEnvelope(
          toUint8Array(message.value),
        ));
      } catch (error) {
        console.error('Invalid Kafka envelope', error);
        return;
      }

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
        metadata,
        payload,
      };

      sockets.forEach((socket) => {
        socket.emit(ProtocolMessageEventName, eventPayload);
      });

      if (onMessageProcessed) {
        await onMessageProcessed(metadata, payload);
      }
    },
  });
};
