import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface UploadParams {
  /** Object key, e.g. `products/<uuid>.jpg`. Prefix conventions per S0 spec §38. */
  key: string;
  body: Uint8Array | string;
  contentType?: string;
}

export interface UploadResult {
  key: string;
  size: number;
}

export interface SignedUrlOptions {
  /** Seconds the URL stays valid. Default 15 minutes. */
  expiresInSec?: number;
}

/**
 * Unified object storage gateway (Sprint 0 task §18).
 *
 * All business modules interact with object storage exclusively through this
 * service - direct MinIO/AWS SDK usage elsewhere is forbidden (AGENTS.md §68).
 * Buckets are private; reads go through short-lived signed URLs.
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const s3 = config.getOrThrow<{
      endpoint: string;
      accessKey: string;
      secretKey: string;
      bucket: string;
      forcePathStyle: boolean;
    }>('app.s3');
    this.bucket = s3.bucket;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: 'us-east-1',
      forcePathStyle: s3.forcePathStyle,
      credentials: {
        accessKeyId: s3.accessKey,
        secretAccessKey: s3.secretKey,
      },
    });
  }

  /** Development/test convenience: make sure the configured bucket exists. */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    await this.ensureBucket();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    const body =
      typeof params.body === 'string' ? new TextEncoder().encode(params.body) : params.body;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: body,
        ContentType: params.contentType,
      }),
    );
    return { key: params.key, size: body.byteLength };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: options.expiresInSec ?? 900,
    });
  }

  /**
   * 读取对象字节（服务端内部使用，例如把多张面单 PDF 合并成一个文件）。
   * 业务模块不得把该字节流直接回给浏览器——对外仍只给签名 URL（§68）。
   */
  async download(key: string): Promise<Buffer> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (object.Body === undefined) {
      throw new Error(`object body missing: ${key}`);
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name ?? '';
      if (name === 'NoSuchKey' || name === 'NotFound' || name === '404') {
        return false;
      }
      throw error;
    }
  }
}
