import { Column, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

export type PersistenceDocId = string;

@Entity({ name: 'document_snapshots' })
@Index(['docId', 'parentId', 'version'], { unique: true })
export class DocumentSnapshot {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 128 })
  docId!: string;

  @Column({ type: 'varchar', length: 128 })
  roomId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  parentId?: string;

  @Column({ type: 'bigint' })
  version!: string;

  @Column({ type: 'bigint' })
  timestamp!: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;

  @Column({ type: 'longblob' })
  data!: Buffer;

  @Column({ type: 'varchar', length: 256, nullable: true })
  storageLocation?: string;
}

@Entity({ name: 'update_history' })
@Index(['roomId', 'docId', 'version'])
export class UpdateHistory {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 128 })
  docId!: string;

  @Column({ type: 'varchar', length: 128 })
  roomId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  parentId?: string;

  @Column({ type: 'bigint' })
  version!: string;

  @Column({ type: 'bigint' })
  timestamp!: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;

  @Column({ type: 'text' })
  metadata!: string;

  @Column({ type: 'longblob' })
  payload!: Buffer;
}

export interface PersistenceMetadata {
  docId: string;
  version: string;
  roomId?: string;
  parentId?: string;
  timestamp?: number;
  storageLocation?: string;
}

export interface PersistenceAdapter {
  loadLatestSnapshot(
    docId: string,
    roomId: string,
    parentId?: string,
  ): Promise<DocumentSnapshot | null>;
  persistSnapshot(metadata: PersistenceMetadata, binary: Buffer): Promise<void>;
  persistUpdate(
    metadata: PersistenceMetadata,
    binary: Buffer,
    historyOnly?: boolean,
  ): Promise<void>;
  exportHistory(
    docId: string,
    roomId: string,
    parentId?: string,
    sinceVersion?: string,
  ): Promise<UpdateHistory[]>;
}
