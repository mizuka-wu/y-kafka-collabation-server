import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Kafka } from 'kafkajs';
import {
  DefaultRoomRegistry,
  KafkaConsumer,
  KafkaConsumerRunConfig,
  startKafkaConsumer,
  TopicResolver,
} from '@y-kafka-collabation-server/bus';
import {
  decodeKafkaEnvelope,
  encodeKafkaEnvelope,
} from '@y-kafka-collabation-server/protocol';
import {
  createPersistenceCoordinator,
  PersistenceCoordinator,
  PersistenceMetadata,
  SnapshotRecovery,
} from '@y-kafka-collabation-server/persistence';

const ensureBuffer = (data: Uint8Array | Buffer | null): Buffer =>
  data instanceof Buffer ? data : Buffer.from(data ?? []);

class KafkaJSConsumerAdapter implements KafkaConsumer {
  private consumer?: ReturnType<Kafka['consumer']>;
  private connected = false;

  constructor(
    private readonly kafka: Kafka,
    private readonly groupId: string,
  ) {}

  private getConsumer() {
    if (!this.consumer) {
      this.consumer = this.kafka.consumer({ groupId: this.groupId });
    }
    return this.consumer;
  }

  async subscribe(topic: string) {
    const consumer = this.getConsumer();
    if (!this.connected) {
      await consumer.connect();
      this.connected = true;
    }
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  async run(config: KafkaConsumerRunConfig) {
    const consumer = this.getConsumer();
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        await config.eachMessage({
          topic,
          partition,
          offset: message.offset,
          value: message.value ?? null,
        });
      },
    });
  }

  async stop() {
    if (this.connected) {
      await this.consumer?.disconnect();
      this.connected = false;
    }
  }
}

@Injectable()
export class ProtocolTransportService implements OnModuleInit, OnModuleDestroy {
  private readonly persistence: PersistenceCoordinator;
  private kafkaConsumerAdapter?: KafkaJSConsumerAdapter;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.persistence = createPersistenceCoordinator(dataSource);
  }

  async onModuleInit() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
    const groupId = process.env.KAFKA_GROUP ?? 'protocol-group';
    const docId = process.env.Y_DOC_ID ?? 'main-doc';

    const snapshot = await this.persistence.recoverSnapshot(docId);
    this.logSnapshotState(snapshot);

    const kafka = new Kafka({ clientId: 'protocol-bus', brokers });
    this.kafkaConsumerAdapter = new KafkaJSConsumerAdapter(kafka, groupId);

    const topicResolver: TopicResolver = {
      resolveDocTopic: (roomId) => `yjs-doc-${roomId}`,
      resolveAwarenessTopic: (roomId) => `yjs-awareness-${roomId}`,
      resolveControlTopic: (roomId) => `yjs-control-${roomId}`,
      docTopicPattern: process.env.DOC_TOPIC_PATTERN ?? 'yjs-doc-*',
      awarenessTopicPattern:
        process.env.AWARENESS_TOPIC_PATTERN ?? 'yjs-awareness-*',
    };

    startKafkaConsumer({
      kafkaConsumer: this.kafkaConsumerAdapter,
      roomRegistry: new DefaultRoomRegistry(),
      protocolCodec: {
        encodeKafkaEnvelope,
        decodeKafkaEnvelope,
      },
      topicResolver,
      onMessageProcessed: (metadata, payload) =>
        this.onKafkaMessage(metadata, payload, docId),
    });
  }

  async onModuleDestroy() {
    await this.kafkaConsumerAdapter?.stop();
  }

  private logSnapshotState(recovery: SnapshotRecovery | null) {
    if (recovery) {
      console.debug(
        `Recovered snapshot version ${recovery.version} for ${recovery.docId}`,
      );
    } else {
      console.debug('No snapshot found; will stream from Kafka');
    }
  }

  private async onKafkaMessage(
    metadata: PersistenceMetadata,
    payload: Uint8Array,
    fallbackDocId: string,
  ) {
    const docId = metadata.docId ?? metadata.roomId ?? fallbackDocId;
    if (!docId) {
      return;
    }
    const metadataWithDoc: PersistenceMetadata = {
      ...metadata,
      docId,
      version: metadata.version ?? Number(metadata.timestamp ?? Date.now()),
    };
    await this.persistence.persistUpdate(
      metadataWithDoc,
      ensureBuffer(payload),
    );
  }
}
