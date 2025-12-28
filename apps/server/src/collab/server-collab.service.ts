import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer, Partitioners, Consumer } from 'kafkajs';
import { DataSource, Repository, MoreThan } from 'typeorm';
import * as Y from 'ywasm';
import {
  DocumentSnapshot,
  UpdateHistory,
} from '@y-kafka-collabation-server/persistence';
import {
  decodeKafkaEnvelope,
  encodeKafkaEnvelope,
  ProtocolMessageMetadata,
} from '@y-kafka-collabation-server/protocol';
import { Buffer } from 'buffer';

import { CollabChannel } from './types';
import { EnvTopicResolver, TopicResolver } from '../kafka/topic-resolver';

type KafkaTailPosition = {
  topic: string;
  partition: number;
  offset: string;
};

@Injectable()
export class ServerCollabService implements OnModuleDestroy {
  private readonly logger = new Logger(ServerCollabService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumer: Consumer;
  private readonly topicResolver: TopicResolver;
  private readonly messages = new Map<string, Uint8Array[]>();
  private readonly kafkaTail = new Map<string, KafkaTailPosition>();
  private readonly dataSource: DataSource;
  private snapshotRepo?: Repository<DocumentSnapshot>;
  private historyRepo?: Repository<UpdateHistory>;
  private readonly kafkaReady: Promise<void>;
  private readonly kafkaConsumerReady: Promise<void>;
  private readonly persistenceReady: Promise<void>;
  private readonly updateListeners: Array<
    (metadata: ProtocolMessageMetadata, payload: Uint8Array) => void
  > = [];
  private ywasmModule?: Promise<typeof import('ywasm')>;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
      .split(',')
      .map((item) => item.trim());
    this.kafka = new Kafka({
      brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      allowAutoTopicCreation: true,
    });
    this.kafkaReady = this.connectKafka();
    this.consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_CONSUMER_GROUP ?? 'collab-server-sync',
      allowAutoTopicCreation: true,
    });
    this.topicResolver = new EnvTopicResolver();

    this.dataSource = new DataSource({
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      username: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE ?? 'collab',
      synchronize: true,
      logging: false,
      entities: [DocumentSnapshot, UpdateHistory],
      poolSize: 10,
      extra: {
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
      },
    });
    this.persistenceReady = this.initializePersistence();
    this.kafkaConsumerReady = this.startKafkaConsumer();
  }

  async getStatus() {
    await Promise.all([this.kafkaReady, this.persistenceReady]);
    if (!this.snapshotRepo) {
      return [];
    }

    const snapshots = await this.snapshotRepo.find();
    const docIds = new Set<string>([
      ...snapshots.map((row) => row.docId),
      ...Array.from(this.messages.keys()),
    ]);
    return Array.from(docIds).map((docId) => ({
      docId,
      kafkaMessageCount: this.messages.get(docId)?.length ?? 0,
      latestSnapshot:
        snapshots.find((row) => row.docId === docId)?.data ?? null,
    }));
  }

  async getDocumentState(docId: string) {
    await Promise.all([
      this.kafkaReady,
      this.kafkaConsumerReady,
      this.persistenceReady,
    ]);

    // 1. Get latest snapshot from DB
    let snapshot: string | null = null;
    let snapshotVersion: string | null = null;
    if (this.snapshotRepo) {
      const record = await this.snapshotRepo.findOne({
        where: { docId },
        order: { version: 'DESC' },
      });
      if (record) {
        snapshot = record.data;
        snapshotVersion = record.version;
      }
    }

    // 2. Get recent updates from history storage
    let updates: string[] = [];
    if (this.historyRepo) {
      const history = await this.historyRepo.find({
        where: snapshotVersion
          ? {
              docId,
              version: MoreThan(snapshotVersion),
            }
          : { docId },
        order: { version: 'ASC' },
        take: 200,
      });
      updates = history.map((entry) => entry.payload);
    }

    const kafkaUpdates =
      this.messages
        .get(docId)
        ?.map((buf) => Buffer.from(buf).toString('base64')) ?? [];

    const aggregatedUpdates =
      (await this.aggregateKafkaUpdates(docId, kafkaUpdates)) ?? kafkaUpdates;

    return {
      docId,
      snapshot,
      updates,
      kafkaUpdates: aggregatedUpdates,
      kafkaTail: this.kafkaTail.get(docId) ?? null,
    };
  }

  async publishUpdate(params: {
    metadata: ProtocolMessageMetadata;
    channel?: CollabChannel;
    payload: Uint8Array;
  }) {
    const { metadata, channel = 'doc', payload } = params;
    const roomId = metadata.roomId ?? metadata.docId;
    const docId = metadata.docId;
    if (!roomId || !docId) {
      throw new Error('metadata.roomId and metadata.docId are required');
    }
    await this.kafkaReady;
    const topic = this.resolveTopic(metadata, channel);
    const envelope = encodeKafkaEnvelope(payload, metadata);
    await this.producer.send({
      topic,
      messages: [{ value: Buffer.from(envelope) }],
    });
    this.logger.log(
      `Published ${channel} update for ${docId} (room ${roomId}) to topic ${topic} (bytes=${payload.byteLength})`,
    );
    return {
      docId,
      roomId,
      channel,
      topic,
      payload: Buffer.from(payload).toString('base64'),
      metadata,
    };
  }

  async persistSnapshot(params: {
    docId: string;
    snapshot: string;
    version: string;
    subdocId?: string;
    timestamp?: number;
  }) {
    const { docId, snapshot, version, subdocId, timestamp } = params;
    if (!version) {
      throw new Error('Snapshot version is required');
    }
    await this.persistenceReady;
    if (!this.snapshotRepo) {
      throw new Error('Persistence layer not initialized');
    }
    const record = this.snapshotRepo.create({
      docId,
      subdocId,
      version,
      timestamp: timestamp ?? Date.now(),
      data: snapshot,
      storageLocation: 'server',
    });
    await this.snapshotRepo.save(record);
    this.logger.log(`Persisted snapshot for ${docId} via TypeORM`);
    return { docId, persisted: true };
  }

  getMessages(docId: string) {
    return {
      docId,
      messages:
        this.messages
          .get(docId)
          ?.map((buf) => Buffer.from(buf).toString('base64')) ?? [],
    };
  }

  registerUpdateListener(
    listener: (metadata: ProtocolMessageMetadata, payload: Uint8Array) => void,
  ) {
    this.updateListeners.push(listener);
  }

  async onModuleDestroy() {
    await this.producer.disconnect().catch((error) => {
      this.logger.warn('Kafka producer disconnect failed', error);
    });
    await this.consumer.disconnect().catch((error) => {
      this.logger.warn('Kafka consumer disconnect failed', error);
    });
    await this.dataSource.destroy().catch((error) => {
      this.logger.warn('TypeORM data source shutdown failed', error);
    });
  }

  private enqueueMessage(docId: string, content: Uint8Array) {
    if (!this.messages.has(docId)) {
      this.messages.set(docId, []);
    }
    const record = this.messages.get(docId)!;
    record.push(new Uint8Array(content));
    if (record.length > 20) {
      record.shift();
    }
  }

  private resolveTopic(
    metadata: ProtocolMessageMetadata,
    channel: CollabChannel = 'doc',
  ) {
    if (channel === 'awareness') {
      return this.topicResolver.resolveAwarenessTopic(metadata);
    }
    if (channel === 'control') {
      return this.topicResolver.resolveControlTopic(metadata);
    }
    return this.topicResolver.resolveDocTopic(metadata);
  }

  private async aggregateKafkaUpdates(
    docId: string,
    updates: string[],
  ): Promise<string[] | undefined> {
    if (updates.length === 0) {
      return undefined;
    }
    if (updates.length === 1) {
      return updates;
    }
    try {
      const { YDoc, applyUpdate, encodeStateAsUpdate } = Y;
      const ydoc = new YDoc(undefined);
      let applied = false;
      updates.forEach((base64, index) => {
        try {
          const buffer = Buffer.from(base64, 'base64');
          applyUpdate(ydoc, buffer, undefined);
          applied = true;
        } catch (error) {
          this.logger.warn(
            `Failed to apply Kafka update #${index} during yjs aggregation`,
            error as Error,
          );
        }
      });
      if (!applied) {
        return updates;
      }
      const merged = encodeStateAsUpdate(ydoc);
      return [Buffer.from(merged).toString('base64')];
    } catch (error) {
      this.logger.warn(
        'yjs aggregation failed, fallback to raw updates',
        error,
      );
      return updates;
    }
  }

  private async connectKafka() {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  private async startKafkaConsumer() {
    await this.persistenceReady;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.topicResolver.docTopicPattern,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: this.topicResolver.awarenessTopicPattern,
      fromBeginning: false,
    });
    if (this.topicResolver.controlTopicPattern) {
      await this.consumer.subscribe({
        topic: this.topicResolver.controlTopicPattern,
        fromBeginning: false,
      });
    }
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) {
          return;
        }
        try {
          const envelope = new Uint8Array(
            message.value.buffer,
            message.value.byteOffset,
            message.value.byteLength,
          );
          const { metadata } = decodeKafkaEnvelope(envelope);
          if (!metadata.docId) {
            return;
          }
          this.kafkaTail.set(metadata.docId, {
            topic,
            partition,
            offset: message.offset,
          });
          this.enqueueMessage(metadata.docId, envelope);
          await this.recordHistory(metadata, envelope);
          for (const listener of this.updateListeners) {
            listener(metadata, envelope);
          }
        } catch (error) {
          this.logger.error(
            'Kafka consumer failed to process message',
            error as Error,
          );
        }
      },
    });
    this.logger.log('Kafka consumer running');
  }

  private async initializePersistence() {
    await this.dataSource.initialize();
    this.snapshotRepo = this.dataSource.getRepository(DocumentSnapshot);
    this.historyRepo = this.dataSource.getRepository(UpdateHistory);
    this.logger.log('TypeORM persistence ready');
  }

  private async recordHistory(
    metadata: ProtocolMessageMetadata,
    envelope: Uint8Array,
  ) {
    if (!this.historyRepo || !metadata.docId) {
      return;
    }
    if (!metadata.version) {
      this.logger.warn(
        `Skipping history persistence for ${metadata.docId} due to missing metadata.version`,
      );
      return;
    }
    const record = this.historyRepo.create({
      docId: metadata.docId,
      subdocId: metadata.subdocId,
      version: metadata.version,
      timestamp: metadata.timestamp ?? Date.now(),
      metadata: JSON.stringify({ roomId: metadata.roomId }),
      payload: Buffer.from(envelope).toString('base64'),
    });
    await this.historyRepo.save(record);
  }
}
