import type { KafkaMessage } from './types';
import { StartKafkaConsumerDeps } from './types';

const toUint8Array = (data: Uint8Array | Buffer): Uint8Array =>
  data instanceof Uint8Array ? data : new Uint8Array(data);

const defaultDocTopic = 'yjs-doc-*';
const defaultAwarenessTopic = 'yjs-awareness-*';

export const startKafkaConsumer = async (deps: StartKafkaConsumerDeps) => {
  const {
    kafkaConsumer,
    roomRegistry,
    protocolCodec,
    topicResolver,
    onMessageEvent = 'protocol-message',
  } = deps;

  const docTopicPattern = topicResolver.docTopicPattern ?? defaultDocTopic;
  const awarenessTopicPattern =
    topicResolver.awarenessTopicPattern ?? defaultAwarenessTopic;

  await kafkaConsumer.subscribe(docTopicPattern);
  await kafkaConsumer.subscribe(awarenessTopicPattern);

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

      const roomId = metadata.roomId;
      const docId = metadata.docId;

      if (!roomId || !docId) {
        return;
      }

      const sockets = metadata.subdocId
        ? roomRegistry.getSockets(docId, metadata.subdocId)
        : roomRegistry.getSockets(docId);
      if (sockets.length === 0) {
        return;
      }

      sockets.forEach((socket) => {
        socket.emit(onMessageEvent, {
          topic: message.topic,
          partition: message.partition,
          offset: message.offset,
          metadata,
          payload,
        });
      });
    },
  });
};
