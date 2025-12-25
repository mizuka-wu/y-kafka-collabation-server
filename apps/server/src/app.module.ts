import { Module } from '@nestjs/common';

import { LinksModule } from './links/links.module';
import { DemoProviderModule } from './provider/demo-provider.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';

@Module({
  imports: [LinksModule, DemoProviderModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
