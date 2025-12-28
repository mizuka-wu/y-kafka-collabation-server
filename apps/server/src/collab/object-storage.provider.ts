import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LocalObjectStorageClient,
  ObjectStorageClient,
} from '@y-kafka-collabation-server/persistence';

import { AppConfigSnapshot } from '../config/configuration';

export const OBJECT_STORAGE_CLIENT = Symbol('OBJECT_STORAGE_CLIENT');

export const objectStorageProvider: Provider = {
  provide: OBJECT_STORAGE_CLIENT,
  useFactory: (
    configService: ConfigService<AppConfigSnapshot>,
  ): ObjectStorageClient => {
    const storageConfig = configService.get('storage', { infer: true });
    if (!storageConfig || storageConfig.driver === 'local') {
      return new LocalObjectStorageClient({
        basePath: storageConfig?.basePath,
      });
    }
    throw new Error(
      `Storage driver "${storageConfig.driver}" is not supported yet. Provide your own ObjectStorageClient via OBJECT_STORAGE_CLIENT token.`,
    );
  },
  inject: [ConfigService],
};
