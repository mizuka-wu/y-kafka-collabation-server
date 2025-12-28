import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Buffer } from 'buffer';
import { BadRequestException } from '@nestjs/common';
import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';
import { ServerCollabService } from './server-collab.service';
import { PublishUpdateDto } from './dto/publish-update.dto';
import { PersistSnapshotDto } from './dto/persist-snapshot.dto';
import { DocumentStateDto } from './dto/document-state.dto';

@ApiTags('collab')
@Controller('collab')
export class ServerCollabController {
  constructor(private readonly collab: ServerCollabService) {}

  @Get('doc/:docId')
  @ApiOperation({
    summary: 'Get document state',
    description:
      'Returns the latest snapshot and recent updates for a document.',
  })
  @ApiResponse({
    status: 200,
    description: 'Document state retrieved successfully.',
    type: DocumentStateDto,
  })
  async getDocumentState(@Param('docId') docId: string) {
    return this.collab.getDocumentState(docId);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get current service status',
    description:
      'Returns the message count and latest snapshot for known documents.',
  })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully.' })
  getStatus() {
    return this.collab.getStatus();
  }

  @Post('publish')
  @ApiOperation({
    summary: 'Publish a document update',
    description: 'Publishes a Yjs update to the Kafka topic.',
  })
  @ApiResponse({ status: 201, description: 'Update published successfully.' })
  async publish(@Body() payload: PublishUpdateDto) {
    if (!payload.version) {
      throw new BadRequestException('version is required');
    }
    const binaryContent = Buffer.from(payload.content, 'base64');
    const metadata: ProtocolMessageMetadata = {
      roomId: payload.roomId ?? 'default',
      docId: payload.docId,
      subdocId: payload.subdocId,
      version: payload.version,
      senderId: payload.senderId,
      timestamp: payload.timestamp ?? Date.now(),
      note: payload.note,
    };
    return this.collab.publishUpdate({
      metadata,
      channel: payload.channel ?? 'doc',
      payload: new Uint8Array(
        binaryContent.buffer,
        binaryContent.byteOffset,
        binaryContent.byteLength,
      ),
    });
  }

  @Post('persist')
  @ApiOperation({
    summary: 'Persist a document snapshot',
    description: 'Saves a full document snapshot to the database.',
  })
  @ApiResponse({ status: 201, description: 'Snapshot persisted successfully.' })
  async persist(@Body() payload: PersistSnapshotDto) {
    return this.collab.persistSnapshot({
      docId: payload.docId,
      snapshot: payload.snapshot,
      version: payload.version,
      subdocId: payload.subdocId,
      timestamp: payload.timestamp,
    });
  }
}
