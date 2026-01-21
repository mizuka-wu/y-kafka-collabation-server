import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { CollabService } from './collab.service';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableCors();

    // Attach YKafkaRuntime to the underlying HTTP server
    const collabService = app.get(CollabService);
    const httpServer = app.getHttpServer();
    collabService.attach(httpServer);

    const config = new DocumentBuilder()
      .setTitle('Y-Kafka Collab Server')
      .setDescription('API for Yjs Kafka Collaboration Server')
      .setVersion('1.0')
      .addTag('collab')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);

    await app.listen(3000);
    const logger = app.get(Logger);
    logger.log(`Application is running on: ${await app.getUrl()}`);
  } catch (error) {
    console.error('Bootstrap failed:', error);
  }
}

void bootstrap();
