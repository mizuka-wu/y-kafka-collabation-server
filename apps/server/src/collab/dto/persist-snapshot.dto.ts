import { ApiProperty } from '@nestjs/swagger';

export class PersistSnapshotDto {
  @ApiProperty({ description: 'The document ID' })
  docId: string;

  @ApiProperty({
    description: 'The snapshot content (Base64 or stringified JSON)',
  })
  snapshot: string;
}
