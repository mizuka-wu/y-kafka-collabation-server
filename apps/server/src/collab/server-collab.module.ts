import { Module } from '@nestjs/common';

import { ServerCollabController } from './server-collab.controller';
import { ServerCollabGateway } from './server-collab.gateway';
import { ServerCollabService } from './server-collab.service';

@Module({
  imports: [],
  controllers: [ServerCollabController],
  providers: [ServerCollabService, ServerCollabGateway],
  exports: [ServerCollabService],
})
export class ServerCollabModule {}
