import { ApiProperty } from '@nestjs/swagger';

class KafkaTailDto {
  @ApiProperty({ description: 'Kafka topic name' })
  topic!: string;

  @ApiProperty({ description: 'Kafka partition number' })
  partition!: number;

  @ApiProperty({ description: 'Kafka offset (string)' })
  offset!: string;
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
    description: 'Recent updates that might not be in the snapshot',
    type: [String],
  })
  updates: string[];

  @ApiProperty({
    description:
      'Latest Kafka messages (base64 envelopes) used for aggregation',
    type: [String],
  })
  kafkaUpdates: string[];

  @ApiProperty({
    description: 'Latest Kafka tail position used for replay',
    required: false,
    nullable: true,
    type: KafkaTailDto,
  })
  kafkaTail?: KafkaTailDto | null;
}
