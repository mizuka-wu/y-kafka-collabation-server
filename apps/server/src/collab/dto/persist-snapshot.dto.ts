import { ApiProperty } from '@nestjs/swagger';

export class PersistSnapshotDto {
  @ApiProperty({ description: 'The document ID' })
  docId: string;

  @ApiProperty({
    description: 'The snapshot content (Base64 or stringified JSON)',
  })
  snapshot: string;

  @ApiProperty({
    description: 'Metadata version carried with the snapshot',
  })
  version: string;

  @ApiProperty({
    description: 'Optional subdoc identifier',
    required: false,
  })
  subdocId?: string;

  @ApiProperty({
    description: 'Optional timestamp (ms) representing snapshot capture time',
    required: false,
  })
  timestamp?: number;
}
