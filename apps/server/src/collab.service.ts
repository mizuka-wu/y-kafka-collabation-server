import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { YKafkaRuntime } from '@y-kafka-collabation-server/runtime';
import { Channel } from '@y-kafka-collabation-server/transport';

@Injectable()
export class CollabService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollabService.name);
  private runtime: YKafkaRuntime;

  constructor(private dataSource: DataSource) {
    // 这里使用硬编码配置作为示例，实际应注入 ConfigService
    this.runtime = new YKafkaRuntime({
      kafka: {
        client: {
          clientId: 'y-collab-server',
          brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
        },
        consumer: {
          groupId: 'y-collab-server-group',
        },
        topicTemplates: {
          [Channel.Sync]: 'y-kafka-collabation-sync',
          [Channel.Awareness]: 'y-kafka-collabation-awareness',
          [Channel.Control]: 'y-kafka-collabation-control',
        },
      },
      database: dataSource,
      socketIO: {
        path: '/socket.io',
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
          credentials: true,
        },
      },
      options: {
        enablePersistenceWorker: true,
        enableRealtimeWorker: true,
      },
    });
  }

  async onModuleInit() {
    this.logger.log('Starting YKafkaRuntime...');
    await this.runtime.start();
    this.logger.log('YKafkaRuntime started.');
  }

  async onModuleDestroy() {
    this.logger.log('Stopping YKafkaRuntime...');
    await this.runtime.stop();
    this.logger.log('YKafkaRuntime stopped.');
  }

  public attach(server: any) {
    this.logger.log('Attaching YKafkaRuntime to HTTP Server...');
    this.runtime.attach(server);
  }
}
