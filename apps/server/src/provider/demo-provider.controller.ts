import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { DemoProviderService } from './demo-provider.service';

@Controller('demo/provider')
export class DemoProviderController {
  constructor(private readonly service: DemoProviderService) {}

  @Get('status')
  getStatus() {
    return this.service.getStatus();
  }

  @Post('messages')
  addMessage(@Body('text') text: string) {
    if (!text?.trim()) {
      throw new BadRequestException('text is required');
    }
    return this.service.addLocalMessage(text);
  }

  @Post('simulate')
  simulateRemote(@Body('text') text: string) {
    if (!text?.trim()) {
      throw new BadRequestException('text is required');
    }
    return this.service.simulateRemoteMessage(text);
  }
}
