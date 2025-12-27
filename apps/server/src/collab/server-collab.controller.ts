import { Body, Controller, Get, Post } from '@nestjs/common';
import { ServerCollabService } from './server-collab.service';

@Controller('collab')
export class ServerCollabController {
  constructor(private readonly collab: ServerCollabService) {}

  @Get('status')
  getStatus() {
    return this.collab.getStatus();
  }

  @Post('publish')
  async publish(
    @Body() payload: { roomId?: string; docId: string; content: string },
  ) {
    return this.collab.publishUpdate(
      payload.roomId ?? 'default',
      payload.docId,
      payload.content,
    );
  }

  @Post('persist')
  async persist(@Body() payload: { docId: string; snapshot: string }) {
    return this.collab.persistSnapshot(payload.docId, payload.snapshot);
  }
}
