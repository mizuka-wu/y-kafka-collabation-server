import { DataSource, FindOptionsWhere, MoreThan } from 'typeorm';
import {
  DocumentSnapshot,
  PersistenceAdapter,
  PersistenceMetadata,
  UpdateHistory,
} from './types';

const toBase64 = (buffer: Buffer | Uint8Array): string =>
  Buffer.from(buffer).toString('base64');

export class TypeOrmPersistenceAdapter implements PersistenceAdapter {
  private snapshotRepo;
  private historyRepo;

  constructor(private dataSource: DataSource) {
    this.snapshotRepo = this.dataSource.getRepository(DocumentSnapshot);
    this.historyRepo = this.dataSource.getRepository(UpdateHistory);
  }

  async loadLatestSnapshot(docId: string, subdocId?: string) {
    return this.snapshotRepo.findOne({
      where: {
        docId,
        subdocId,
      },
      order: {
        version: 'DESC',
      },
    });
  }

  async persistSnapshot(metadata: PersistenceMetadata, binary: Buffer) {
    const version = this.generateVersion();
    const snapshot = this.snapshotRepo.create({
      docId: metadata.docId,
      subdocId: metadata.subdocId,
      version: version, // Use snowflake
      timestamp: metadata.timestamp ?? Date.now(),
      data: toBase64(binary),
      storageLocation: metadata.storageLocation,
    });
    await this.snapshotRepo.save(snapshot);
  }

  async persistUpdate(
    metadata: PersistenceMetadata,
    binary: Buffer,
    historyOnly?: boolean,
  ) {
    const version = this.generateVersion();
    const payload: Partial<UpdateHistory> = {
      docId: metadata.docId,
      subdocId: metadata.subdocId,
      version: version, // Use snowflake
      timestamp: metadata.timestamp ?? Date.now(),
      metadata: JSON.stringify({ roomId: metadata.roomId }),
      payload: toBase64(binary),
    };

    await this.dataSource.transaction(async (manager) => {
      if (!historyOnly) {
        const snapshot = manager.create(DocumentSnapshot, {
          docId: metadata.docId,
          subdocId: metadata.subdocId,
          version: version,
          timestamp: metadata.timestamp ?? Date.now(),
          data: toBase64(binary),
        });
        await manager.save(snapshot);
      }
      await manager.save(UpdateHistory, payload);
    });
  }

  async exportHistory(docId: string, subdocId?: string, sinceVersion?: number) {
    const where: FindOptionsWhere<UpdateHistory> = {
      docId,
      subdocId,
      ...(sinceVersion ? { version: MoreThan(sinceVersion) } : {}),
    };
    return this.historyRepo.find({
      where,
      order: {
        version: 'ASC',
      },
    });
  }
}
