import { PersistenceAdapter, PersistenceMetadata } from './types';

export interface SnapshotRecovery {
  docId: string;
  subdocId?: string;
  version: number;
  data: Buffer;
  storageLocation?: string;
}

export class PersistenceCoordinator {
  constructor(private adapter: PersistenceAdapter) {}

  async recoverSnapshot(
    docId: string,
    subdocId?: string,
  ): Promise<SnapshotRecovery | null> {
    const snapshot = await this.adapter.loadLatestSnapshot(docId, subdocId);
    if (!snapshot) {
      return null;
    }
    return {
      docId: snapshot.docId,
      subdocId: snapshot.subdocId,
      version: snapshot.version,
      data: Buffer.from(snapshot.data, 'base64'),
      storageLocation: snapshot.storageLocation,
    };
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

  async exportHistory(docId: string, subdocId?: string, sinceVersion?: number) {
    return this.adapter.exportHistory(docId, subdocId, sinceVersion);
  }
}
