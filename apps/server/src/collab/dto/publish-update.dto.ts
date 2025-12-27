import { ApiProperty } from '@nestjs/swagger';

export class PublishUpdateDto {
  @ApiProperty({
    description: 'The room ID for the document',
    required: false,
    default: 'default',
  })
  roomId?: string;

  @ApiProperty({ description: 'The document ID' })
  docId: string;

  @ApiProperty({ description: 'The Base64 encoded update content' })
  content: string;
}
