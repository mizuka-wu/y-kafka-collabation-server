import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { TemplateTopicResolver, TopicResolver } from '../kafka/topic-resolver';
import { AppConfigSnapshot } from '../config/configuration';

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

  constructor(
    private readonly configService: ConfigService<AppConfigSnapshot>,
  ) {
    const kafkaConfig = this.configService.get('kafka', { infer: true });
    const mysqlConfig = this.configService.get('mysql', { infer: true });
    if (!kafkaConfig || !mysqlConfig) {
      throw new Error('Application configuration is missing.');
    }

    this.kafka = new Kafka({
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
      retry: kafkaConfig.retry,
    });
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      allowAutoTopicCreation: true,
    });
    this.kafkaReady = this.connectKafka();
    this.consumer = this.kafka.consumer({
      groupId: kafkaConfig.consumerGroup,
      allowAutoTopicCreation: true,
    });
    this.topicResolver = new TemplateTopicResolver(
      kafkaConfig.topics,
      kafkaConfig.topicRoomPriority,
    );

    this.dataSource = new DataSource({
      type: 'mysql',
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      username: mysqlConfig.user,
      password: mysqlConfig.password,
      database: mysqlConfig.database,
      synchronize: mysqlConfig.synchronize,
      logging: false,
      entities: [DocumentSnapshot, UpdateHistory],
      poolSize: mysqlConfig.poolSize,
      extra: {
        connectionLimit: mysqlConfig.poolSize,
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
      latestSnapshot: this.bufferToBase64(
        snapshots.find((row) => row.docId === docId)?.data ?? null,
      ),
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
        snapshot = this.bufferToBase64(record.data);
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
      updates = history
        .map((entry) => this.bufferToBase64(entry.payload))
        .filter((payload): payload is string => Boolean(payload));
    }

    const kafkaUpdatesRaw =
      this.messages
        .get(docId)
        ?.map((buf) => Buffer.from(buf).toString('base64')) ?? [];

    const kafkaAggregated =
      (await this.aggregateKafkaUpdates(docId, kafkaUpdatesRaw)) ??
      kafkaUpdatesRaw;

    const mergedUpdates = [...updates, ...kafkaAggregated];

    const response: {
      docId: string;
      snapshot: string | null;
      updates: string[];
      _debug?: {
        kafkaUpdates: string[];
        kafkaTail?: KafkaTailPosition | null;
      };
    } = {
      docId,
      snapshot,
      updates: mergedUpdates,
    };

    const kafkaTail = this.kafkaTail.get(docId) ?? null;
    if (kafkaUpdatesRaw.length > 0 || kafkaTail) {
      response._debug = {
        kafkaUpdates: kafkaUpdatesRaw,
        kafkaTail,
      };
    }

    return response;
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
      data: this.snapshotInputToBuffer(snapshot),
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
    return this.topicResolver.resolveSyncTopic(metadata);
  }

  private bufferToBase64(
    input?: Buffer | Uint8Array | string | null,
  ): string | null {
    if (!input) {
      return null;
    }
    if (typeof input === 'string') {
      return input;
    }
    if (Buffer.isBuffer(input)) {
      return input.toString('base64');
    }
    return Buffer.from(input).toString('base64');
  }

  private snapshotInputToBuffer(snapshot: string): Buffer {
    if (!snapshot) {
      return Buffer.alloc(0);
    }
    const normalized = snapshot.trim();
    const isLikelyBase64 =
      normalized.length > 0 &&
      normalized.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
    if (isLikelyBase64) {
      try {
        return Buffer.from(normalized, 'base64');
      } catch (error) {
        this.logger.warn(
          'Snapshot content is not valid base64, fallback to utf8 encoding',
          error as Error,
        );
      }
    }
    return Buffer.from(snapshot, 'utf8');
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
      topic: this.topicResolver.syncTopicPattern,
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
    if (!this.historyRepo) {
      return;
    }
    if (!metadata.docId) {
      this.logger.warn(
        'Skipping history persistence due to missing metadata.docId',
      );
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
      payload: Buffer.from(envelope),
    });
    await this.historyRepo.save(record);
  }
}
