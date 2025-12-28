import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ServerCollabController } from './server-collab.controller';
import { ServerCollabGateway } from './server-collab.gateway';
import { ServerCollabService } from './server-collab.service';
import {
  objectStorageProvider,
  OBJECT_STORAGE_CLIENT,
} from './object-storage.provider';

@Module({
  imports: [ConfigModule],
  controllers: [ServerCollabController],
  providers: [ServerCollabService, ServerCollabGateway, objectStorageProvider],
  exports: [ServerCollabService, OBJECT_STORAGE_CLIENT],
})
export class ServerCollabModule {}
