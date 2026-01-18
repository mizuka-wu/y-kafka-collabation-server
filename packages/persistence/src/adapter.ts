import { DataSource, FindOptionsWhere, MoreThan, IsNull } from 'typeorm';
import {
  DocumentSnapshot,
  PersistenceAdapter,
  PersistenceMetadata,
  UpdateHistory,
} from './types';
import { SnowflakeIdGenerator } from './utils/snowflake';

const toBuffer = (binary: Buffer | Uint8Array): Buffer => Buffer.from(binary);

export class TypeOrmPersistenceAdapter implements PersistenceAdapter {
  private snapshotRepo;
  private historyRepo;
  private snowflake: SnowflakeIdGenerator;

  constructor(private dataSource: DataSource) {
    this.snapshotRepo = this.dataSource.getRepository(DocumentSnapshot);
    this.historyRepo = this.dataSource.getRepository(UpdateHistory);
    this.snowflake = new SnowflakeIdGenerator(1, 1);
  }

  private generateVersion(): string {
    return this.snowflake.nextId();
  }

  async loadLatestSnapshot(docId: string, roomId: string, parentId?: string) {
    return this.snapshotRepo.findOne({
      where: {
        roomId,
        docId,
        parentId: parentId ?? IsNull(),
      },
      order: {
        version: 'DESC', // Use Offset-based versioning for strict ordering
      },
    });
  }

  async persistSnapshot(metadata: PersistenceMetadata, binary: Buffer) {
    // Prefer provided version (Kafka offset), fallback to snowflake
    const version = metadata.version ?? this.generateVersion();
    const snapshot = this.snapshotRepo.create({
      roomId: metadata.roomId!, // Ensure roomId is present
      docId: metadata.docId,
      parentId: metadata.parentId,
      version: version,
      timestamp: metadata.timestamp ?? Date.now(),
      data: toBuffer(binary),
      storageLocation: metadata.storageLocation,
    });
    await this.snapshotRepo.save(snapshot);
  }

  async persistUpdate(
    metadata: PersistenceMetadata,
    binary: Buffer,
    historyOnly: boolean = true, // Default to true: Updates are deltas, not full snapshots
  ) {
    // Prefer provided version (Kafka offset), fallback to snowflake
    const version = metadata.version ?? this.generateVersion();
    const payload: Partial<UpdateHistory> = {
      roomId: metadata.roomId!,
      docId: metadata.docId,
      parentId: metadata.parentId,
      version: version,
      timestamp: metadata.timestamp ?? Date.now(),
      metadata: JSON.stringify({ roomId: metadata.roomId }),
      payload: toBuffer(binary),
    };

    await this.dataSource.transaction(async (manager) => {
      // Only save snapshot if explicitly requested (and binary is a full snapshot)
      // For standard updates, we should ONLY append to history.
      if (!historyOnly) {
        const snapshot = manager.create(DocumentSnapshot, {
          roomId: metadata.roomId!,
          docId: metadata.docId,
          parentId: metadata.parentId,
          version: version,
          timestamp: metadata.timestamp ?? Date.now(),
          data: toBuffer(binary),
        });
        await manager.save(snapshot);
      }
      await manager.save(UpdateHistory, payload);
    });
  }

  async exportHistory(
    docId: string,
    roomId: string,
    parentId?: string,
    sinceVersion?: string,
  ) {
    const where: FindOptionsWhere<UpdateHistory> = {
      roomId,
      docId,
      parentId: parentId ?? IsNull(),
      ...(sinceVersion ? { version: MoreThan(sinceVersion) } : {}),
    };
    return this.historyRepo.find({
      where,
      order: {
        version: 'ASC', // Order by version (offset) to replay correctly
      },
    });
  }
}
