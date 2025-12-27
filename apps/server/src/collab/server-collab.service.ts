import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer, Partitioners } from 'kafkajs';
import { DataSource, Repository } from 'typeorm';
import {
  DocumentSnapshot,
  SnowflakeIdGenerator,
} from '@y-kafka-collabation-server/persistence';

@Injectable()
export class ServerCollabService implements OnModuleDestroy {
  private readonly logger = new Logger(ServerCollabService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly messages = new Map<string, string[]>();
  private readonly dataSource: DataSource;
  private snapshotRepo?: Repository<DocumentSnapshot>;
  private readonly kafkaReady: Promise<void>;
  private readonly persistenceReady: Promise<void>;
  private readonly updateListeners: Array<
    (docId: string, payload: string) => void
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

    this.dataSource = new DataSource({
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      username: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE ?? 'collab',
      synchronize: true,
      logging: false,
      entities: [DocumentSnapshot],
      poolSize: 10,
      extra: {
        connectionLimit: 10,
        waitForConnections: true,
        queueLimit: 0,
      },
    });
    this.persistenceReady = this.initializePersistence();
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

  async publishUpdate(docId: string, content: string) {
    await this.kafkaReady;
    const topic = this.topicFor(docId);
    await this.producer.send({
      topic,
      messages: [{ value: content }],
    });
    this.enqueueMessage(docId, content);
    this.logger.log(`Published update for ${docId} to topic ${topic}`);
    for (const listener of this.updateListeners) {
      listener(docId, content);
    }
    return {
      docId,
      topic,
      content,
    };
  }

  async persistSnapshot(docId: string, snapshot: string) {
    await this.persistenceReady;
    if (!this.snapshotRepo) {
      throw new Error('Persistence layer not initialized');
    }
    const version = Number(this.snowflake.nextId());
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
      messages: this.messages.get(docId) ?? [],
    };
  }

  registerUpdateListener(listener: (docId: string, payload: string) => void) {
    this.updateListeners.push(listener);
  }

  async onModuleDestroy() {
    await this.producer.disconnect().catch((error) => {
      this.logger.warn('Kafka producer disconnect failed', error);
    });
    await this.dataSource.destroy().catch((error) => {
      this.logger.warn('TypeORM data source shutdown failed', error);
    });
  }

  private enqueueMessage(docId: string, content: string) {
    if (!this.messages.has(docId)) {
      this.messages.set(docId, []);
    }
    const record = this.messages.get(docId)!;
    record.push(content);
    if (record.length > 20) {
      record.shift();
    }
  }

  private topicFor(docId: string) {
    return `docs-${docId}`;
  }

  private async connectKafka() {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  private async initializePersistence() {
    await this.dataSource.initialize();
    this.snapshotRepo = this.dataSource.getRepository(DocumentSnapshot);
    this.logger.log('TypeORM persistence ready');
  }
}
