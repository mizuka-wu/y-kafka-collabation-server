import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, isAbsolute, resolve } from 'path';
import {
  type GetObjectParams,
  type ObjectStorageClient,
  type ObjectStorageOptions,
  type PutObjectParams,
  type PutObjectResult,
} from './object-storage-client';

const FILE_PROTOCOL = 'file://';

const toAbsolutePath = (basePath: string, key: string) => {
  if (isAbsolute(key)) {
    return key;
  }
  return resolve(basePath, key);
};

export class LocalObjectStorageClient implements ObjectStorageClient {
  private basePath: string;

  constructor(options?: Pick<ObjectStorageOptions, 'basePath'>) {
    this.basePath = options?.basePath
      ? resolve(options.basePath)
      : resolve(process.cwd(), '.object-storage', 'snapshots');
  }

  async putObject(params: PutObjectParams): Promise<PutObjectResult> {
    const filePath = toAbsolutePath(this.basePath, params.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, params.body);
    return {
      location: `${FILE_PROTOCOL}${filePath}`,
    };
  }

  async getObject(params: GetObjectParams): Promise<Buffer> {
    const filePath = this.toFilePath(params.location);
    return readFile(filePath);
  }

  private toFilePath(location: string) {
    if (location.startsWith(FILE_PROTOCOL)) {
      return location.slice(FILE_PROTOCOL.length);
    }
    return toAbsolutePath(this.basePath, location);
  }
}
