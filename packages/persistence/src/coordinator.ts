import { PersistenceAdapter, PersistenceMetadata } from './types';

export interface SnapshotRecovery {
  docId: string;
  parentId?: string;
  version: string;
  timestamp: number;
  data: Buffer;
  storageLocation?: string;
}

export class PersistenceCoordinator {
  constructor(private adapter: PersistenceAdapter) {}

  async recoverSnapshot(
    docId: string,
    roomId: string,
    parentId?: string,
  ): Promise<SnapshotRecovery | null> {
    const snapshot = await this.adapter.loadLatestSnapshot(
      docId,
      roomId,
      parentId,
    );
    if (!snapshot) {
      return null;
    }
    const rawData = snapshot.data;
    const bufferData = Buffer.isBuffer(rawData)
      ? Buffer.from(rawData)
      : Buffer.from(rawData, 'base64');
    return {
      docId: snapshot.docId,
      parentId: snapshot.parentId,
      version: snapshot.version,
      timestamp: Number(snapshot.timestamp),
      data: bufferData,
      storageLocation: snapshot.storageLocation,
    };
  }

  async getUpdatesSince(
    docId: string,
    roomId: string,
    parentId?: string,
    sinceVersion?: string,
  ) {
    return this.adapter.exportHistory(docId, roomId, parentId, sinceVersion);
  }

  async persistUpdate(
    metadata: PersistenceMetadata,
    binary: Buffer,
    historyOnly?: boolean,
  ) {
    await this.adapter.persistUpdate(metadata, binary, historyOnly);
  }

  async persistSnapshot(metadata: PersistenceMetadata, binary: Buffer) {
    await this.adapter.persistSnapshot(metadata, binary);
  }

  async exportHistory(
    docId: string,
    roomId: string,
    parentId?: string,
    sinceVersion?: string,
  ) {
    return this.adapter.exportHistory(docId, roomId, parentId, sinceVersion);
  }
}
