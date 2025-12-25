import { Module } from '@nestjs/common';

import { ServerCollabModule } from './collab/server-collab.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';

@Module({
  imports: [ServerCollabModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
