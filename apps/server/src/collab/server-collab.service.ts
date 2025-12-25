import { Injectable, Logger } from '@nestjs/common';

type MessageRecord = {
  payload: string;
  createdAt: number;
};

class KafkaSimulator {
  private readonly logger = new Logger(KafkaSimulator.name);
  private readonly topics = new Map<string, MessageRecord[]>();

  publish(docId: string, payload: string): MessageRecord {
    const record: MessageRecord = {
      payload,
      createdAt: Date.now(),
    };
    if (!this.topics.has(docId)) {
      this.topics.set(docId, []);
    }
    this.topics.get(docId)!.push(record);
    this.logger.log(`Kafka publish: doc=${docId}, size=${payload.length}`);
    return record;
  }

  getTopic(docId: string): MessageRecord[] {
    return this.topics.get(docId) ?? [];
  }

  listDocs(): string[] {
    return Array.from(this.topics.keys());
  }
}

class MySqlSimulator {
  private readonly logger = new Logger(MySqlSimulator.name);
  private readonly snapshots = new Map<string, string>();

  save(docId: string, snapshot: string) {
    this.logger.log(
      `MySQL store: doc=${docId}, snapshotSize=${snapshot.length}`,
    );
    this.snapshots.set(docId, snapshot);
    return {
      docId,
      snapshot,
      createdAt: Date.now(),
    };
  }

  fetch(docId: string) {
    return this.snapshots.get(docId);
  }

  listDocs(): string[] {
    return Array.from(this.snapshots.keys());
  }
}

@Injectable()
export class ServerCollabService {
  private readonly logger = new Logger(ServerCollabService.name);
  private readonly kafka = new KafkaSimulator();
  private readonly mysql = new MySqlSimulator();

  getStatus() {
    const docIds = new Set<string>([
      ...this.kafka.listDocs(),
      ...this.mysql.listDocs(),
    ]);
    return Array.from(docIds).map((docId) => ({
      docId,
      kafkaMessages: this.kafka.getTopic(docId).length,
      latestSnapshot: this.mysql.fetch(docId),
    }));
  }

  publishUpdate(docId: string, content: string) {
    const record = this.kafka.publish(docId, content);
    this.logger.debug(`Published update for ${docId}`);
    return {
      docId,
      record,
    };
  }

  persistSnapshot(docId: string, snapshot: string) {
    const stored = this.mysql.save(docId, snapshot);
    return {
      docId,
      stored,
    };
  }

  getMessages(docId: string) {
    return {
      docId,
      messages: this.kafka.getTopic(docId),
    };
  }
}
