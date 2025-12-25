import { Module } from '@nestjs/common';

import { ServerCollabController } from './server-collab.controller';
import { ServerCollabService } from './server-collab.service';

@Module({
  imports: [],
  controllers: [ServerCollabController],
  providers: [ServerCollabService],
  exports: [ServerCollabService],
})
export class ServerCollabModule {}
