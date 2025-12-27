import { ApiProperty } from '@nestjs/swagger';

export class DocumentStateDto {
  @ApiProperty({ description: 'The unique document identifier' })
  docId: string;

  @ApiProperty({
    description: 'The latest snapshot of the document (base64 encoded)',
    required: false,
    nullable: true,
  })
  snapshot: string | null;

  @ApiProperty({
    description: 'Recent updates that might not be in the snapshot',
    type: [String],
  })
  updates: string[];
}
