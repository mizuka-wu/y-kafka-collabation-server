import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublishUpdateDto {
  @ApiProperty({
    description: 'The room ID for the document',
    required: false,
    default: 'default',
  })
  roomId?: string;

  @ApiProperty({ description: 'The document ID' })
  docId: string;

  @ApiPropertyOptional({
    description: 'Sub document identifier used for fine-grained routing',
  })
  subdocId?: string;

  @ApiProperty({
    description: 'Monotonic version string for this update',
    example: '42',
  })
  version: string;

  @ApiPropertyOptional({
    description: 'Sender identifier, usually the Y.Doc clientID',
  })
  senderId?: string;

  @ApiPropertyOptional({
    description: 'Unix timestamp in milliseconds',
    type: Number,
  })
  timestamp?: number;

  @ApiProperty({
    description: 'Message channel: doc / awareness / control',
    required: false,
    enum: ['doc', 'awareness', 'control'],
    default: 'doc',
  })
  channel?: 'doc' | 'awareness' | 'control';

  @ApiPropertyOptional({
    description: 'Optional note flag stored inside metadata',
  })
  note?: string;

  @ApiProperty({ description: 'The Base64 encoded update content' })
  content: string;
}
