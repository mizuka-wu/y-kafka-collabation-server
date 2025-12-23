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
    const snapshot = this.snapshotRepo.create({
      docId: metadata.docId,
      subdocId: metadata.subdocId,
      version: metadata.version,
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
    const payload: Partial<UpdateHistory> = {
      docId: metadata.docId,
      subdocId: metadata.subdocId,
      version: metadata.version,
      timestamp: metadata.timestamp ?? Date.now(),
      metadata: JSON.stringify({ roomId: metadata.roomId }),
      payload: toBase64(binary),
    };
    if (!historyOnly) {
      const snapshot = this.snapshotRepo.create({
        docId: metadata.docId,
        subdocId: metadata.subdocId,
        version: metadata.version,
        timestamp: metadata.timestamp ?? Date.now(),
        data: toBase64(binary),
      });
      await this.snapshotRepo.save(snapshot);
    }
    await this.historyRepo.save(payload);
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
