export interface PutObjectParams {
  key: string;
  body: Buffer;
  contentType?: string;
}

export interface GetObjectParams {
  location: string;
}

export interface DeleteObjectParams {
  location: string;
}

export interface PutObjectResult {
  location: string;
  etag?: string;
}

/**
 * ObjectStorageClient 是对 S3/MinIO/OSS 等对象存储 SDK 的轻量封装。
 * 默认实现可以是本地文件系统，项目方也可以自行实现并注入。
 */
export interface ObjectStorageClient {
  putObject(params: PutObjectParams): Promise<PutObjectResult>;
  getObject(params: GetObjectParams): Promise<Buffer>;
  deleteObject?(params: DeleteObjectParams): Promise<void>;
}

export type ObjectStorageDriver = 'local' | 's3' | 'minio' | 'oss' | string;

export interface ObjectStorageOptions {
  driver: ObjectStorageDriver;
  bucket?: string;
  basePath?: string;
}
