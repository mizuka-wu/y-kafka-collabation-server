import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer, Partitioners, Consumer } from 'kafkajs';
import { DataSource, Repository, MoreThan } from 'typeorm';
import {
  DocumentSnapshot,
  SnowflakeIdGenerator,
  UpdateHistory,
} from '@y-kafka-collabation-server/persistence';
import { decodeKafkaEnvelope } from '@y-kafka-collabation-server/protocol';
import { Buffer } from 'buffer';

@Injectable()
export class ServerCollabService implements OnModuleDestroy {
  private readonly logger = new Logger(ServerCollabService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumer: Consumer;
  private readonly messages = new Map<string, Uint8Array[]>();
  private readonly dataSource: DataSource;
  private snapshotRepo?: Repository<DocumentSnapshot>;
  private historyRepo?: Repository<UpdateHistory>;
  private readonly kafkaReady: Promise<void>;
  private readonly kafkaConsumerReady: Promise<void>;
  private readonly persistenceReady: Promise<void>;
  private readonly updateListeners: Array<
    (docId: string, payload: Uint8Array) => void
  > = [];
  private readonly snowflake: SnowflakeIdGenerator;

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
    // Initialize Snowflake with worker 2 (server)
    this.snowflake = new SnowflakeIdGenerator(2, 1);
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
    if (this.snapshotRepo) {
      const record = await this.snapshotRepo.findOne({
        where: { docId },
        order: { version: 'DESC' },
      });
      if (record) {
        snapshot = record.data;
      }
    }

    // 2. Get recent updates from history storage
    let updates: string[] = [];
    if (this.historyRepo) {
      const since = snapshot
        ? await this.snapshotRepo?.findOne({
            where: { docId },
            order: { createdAt: 'DESC' },
          })
        : null;
      const createdAfter =
        since?.createdAt ?? new Date(Date.now() - 1000 * 60 * 60 * 24);
      const history = await this.historyRepo.find({
        where: {
          docId,
          createdAt: MoreThan(createdAfter),
        },
        order: { createdAt: 'ASC' },
        take: 200,
      });
      updates = history.map((entry) => entry.payload);
    }

    return {
      docId,
      snapshot,
      updates,
    };
  }

  async publishUpdate(roomId: string, docId: string, content: Uint8Array) {
    await this.kafkaReady;
    const topic = this.topicFor(roomId);
    await this.producer.send({
      topic,
      messages: [{ value: Buffer.from(content) }],
    });
    this.logger.log(
      `Published update for ${docId} (room ${roomId}) to topic ${topic} (bytes=${content.byteLength})`,
    );
    return {
      docId,
      roomId,
      topic,
      content: Buffer.from(content).toString('base64'),
    };
  }

  async persistSnapshot(docId: string, snapshot: string) {
    await this.persistenceReady;
    if (!this.snapshotRepo) {
      throw new Error('Persistence layer not initialized');
    }
    const version = this.snowflake.nextId();
    const record = this.snapshotRepo.create({
      docId,
      version,
      timestamp: Date.now(),
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
    listener: (docId: string, payload: Uint8Array) => void,
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

  private topicFor(roomId: string) {
    return `docs-${roomId}`;
  }

  private async connectKafka() {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  private async startKafkaConsumer() {
    await this.persistenceReady;
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: /^docs-/, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
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
          this.enqueueMessage(metadata.docId, envelope);
          await this.recordHistory(metadata, envelope);
          for (const listener of this.updateListeners) {
            listener(metadata.docId, envelope);
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
    metadata: {
      docId?: string;
      subdocId?: string;
      roomId?: string;
      timestamp?: number;
      version?: string;
    },
    envelope: Uint8Array,
  ) {
    if (!this.historyRepo || !metadata.docId) {
      return;
    }
    const record = this.historyRepo.create({
      docId: metadata.docId,
      subdocId: metadata.subdocId,
      version: metadata.version ?? String(this.snowflake.nextId()),
      timestamp: metadata.timestamp ?? Date.now(),
      metadata: JSON.stringify({ roomId: metadata.roomId }),
      payload: Buffer.from(envelope).toString('base64'),
    });
    await this.historyRepo.save(record);
  }
}
