import { Module } from '@nestjs/common';

import { DemoProviderController } from './demo-provider.controller';
import { DemoProviderService } from './demo-provider.service';

@Module({
  controllers: [DemoProviderController],
  providers: [DemoProviderService],
})
export class DemoProviderModule {}
