import type { DataSource } from 'typeorm';
import { TypeOrmPersistenceAdapter } from './adapter';
import { PersistenceCoordinator } from './coordinator';

export const createPersistenceCoordinator = (dataSource: DataSource) =>
  new PersistenceCoordinator(new TypeOrmPersistenceAdapter(dataSource));

export const buildPersistenceProviders = (dataSourceToken: string) => [
  {
    provide: 'PERSISTENCE_COORDINATOR',
    useFactory: (dataSource: DataSource) =>
      createPersistenceCoordinator(dataSource),
    inject: [dataSourceToken],
  },
];
