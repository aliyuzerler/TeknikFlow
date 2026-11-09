import { Global, Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '../config/env.js';

export const S3_CLIENT = Symbol('S3_CLIENT');

function createS3Client(): S3Client {
  const env = getEnv();
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true, // RustFS ve S3-uyumlu sağlayıcılar için
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
}

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      useFactory: createS3Client,
    },
  ],
  exports: [S3_CLIENT],
})
export class StorageModule {}
