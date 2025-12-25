import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { createPool, Pool, RowDataPacket } from 'mysql2/promise';

type SnapshotRow = {
  doc_id: string;
  snapshot: string;
  updated_at: Date;
};

@Injectable()
export class ServerCollabService implements OnModuleDestroy {
  private readonly logger = new Logger(ServerCollabService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly messages = new Map<string, string[]>();
  private readonly mysqlPool: Pool;
  private readonly kafkaReady: Promise<void>;
  private readonly mysqlReady: Promise<void>;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092')
      .split(',')
      .map((item) => item.trim());
    this.kafka = new Kafka({ brokers });
    this.producer = this.kafka.producer();
    this.kafkaReady = this.connectKafka();

    this.mysqlPool = createPool({
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE ?? 'collab',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
    this.mysqlReady = this.prepareSnapshotTable();
  }

  async getStatus() {
    await Promise.all([this.kafkaReady, this.mysqlReady]);
    const [rows] = await this.mysqlPool.query<RowDataPacket[]>(
      'SELECT doc_id, snapshot, updated_at FROM snapshots',
    );
    const snapshotDocs = (rows as SnapshotRow[]).map((row) => row.doc_id);
    const docIds = new Set<string>([
      ...snapshotDocs,
      ...Array.from(this.messages.keys()),
    ]);
    return Array.from(docIds).map((docId) => ({
      docId,
      kafkaMessageCount: this.messages.get(docId)?.length ?? 0,
      latestSnapshot:
        rows.find((row) => row.doc_id === docId)?.snapshot ?? null,
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
    return {
      docId,
      topic,
      content,
    };
  }

  async persistSnapshot(docId: string, snapshot: string) {
    await this.mysqlReady;
    await this.mysqlPool.execute(
      `INSERT INTO snapshots (doc_id, snapshot) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE snapshot = VALUES(snapshot), updated_at = CURRENT_TIMESTAMP`,
      [docId, snapshot],
    );
    this.logger.log(`Persisted snapshot for ${docId}`);
    return { docId, persisted: true };
  }

  getMessages(docId: string) {
    return {
      docId,
      messages: this.messages.get(docId) ?? [],
    };
  }

  async onModuleDestroy() {
    await this.producer.disconnect().catch((error) => {
      this.logger.warn('Kafka producer disconnect failed', error);
    });
    await this.mysqlPool.end().catch((error) => {
      this.logger.warn('MySQL pool shutdown failed', error);
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

  private async prepareSnapshotTable() {
    await this.mysqlPool.execute(
      `CREATE TABLE IF NOT EXISTS snapshots (
        doc_id VARCHAR(255) PRIMARY KEY,
        snapshot LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
    );
    this.logger.log('MySQL snapshot table ensured');
  }
}
