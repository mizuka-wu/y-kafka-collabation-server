import { ApiProperty } from '@nestjs/swagger';

class KafkaTailDto {
  @ApiProperty({ description: 'Kafka topic name' })
  topic!: string;

  @ApiProperty({ description: 'Kafka partition number' })
  partition!: number;

  @ApiProperty({ description: 'Kafka offset (string)' })
  offset!: string;
}

class DocumentStateDebugDto {
  @ApiProperty({
    description: 'Raw Kafka envelopes (base64) recently cached by the server',
    type: [String],
  })
  kafkaUpdates!: string[];

  @ApiProperty({
    description: 'Latest Kafka tail position used for replay',
    required: false,
    nullable: true,
    type: KafkaTailDto,
  })
  kafkaTail?: KafkaTailDto | null;
}

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
    description:
      'Updates since snapshot. Includes persistence history + latest Kafka aggregation (all base64 encoded).',
    type: [String],
  })
  updates: string[];

  @ApiProperty({
    description:
      'Debug information (optional). Contains raw Kafka cache and tail offsets.',
    required: false,
    nullable: true,
    type: DocumentStateDebugDto,
  })
  _debug?: DocumentStateDebugDto | null;
}
