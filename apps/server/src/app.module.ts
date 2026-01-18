import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { CollabService } from './collab.service';
import {
  DocumentSnapshot,
  UpdateHistory,
} from '@y-kafka-collabation-server/persistence';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_DATABASE || 'y_collab',
      entities: [DocumentSnapshot, UpdateHistory],
      synchronize: true, // 开发环境自动同步 schema
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'warn',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                },
              }
            : undefined,
        autoLogging: true,
        genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, CollabService],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
}
