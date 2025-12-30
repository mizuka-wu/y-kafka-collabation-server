import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '@nestjs/config';

import { AppService } from './app.service';
import { AppController } from './app.controller';

@Module({
  imports: [
    // ConfigModule.forRoot({
    //   load: [configuration],
    //   isGlobal: true,
    // }),
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
  providers: [AppService],
})
export class AppModule {}
