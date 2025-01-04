import { Env } from "../../types";

export class StorageService {
  private readonly endpoint = "https://b6752d5f22354a0f26d0c4af7fc2d232.r2.cloudflarestorage.com/warpify";
  
  constructor(private bucket: R2Bucket) {}

  async uploadFile(key: string, data: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<R2Object> {
    const object = await this.bucket.put(key, data, {
      httpMetadata: {
        contentType: 'text/csv',
      }
    });
    return object;
  }

  async getSignedUrl(key: string): Promise<string> {
    const url = new URL(key, this.endpoint);
    return url.toString();
  }

  async getFile(key: string): Promise<R2ObjectBody | null> {
    return await this.bucket.get(key);
  }

  async deleteFile(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async listFiles(prefix?: string): Promise<R2Object[]> {
    const listed = await this.bucket.list({
      prefix,
      limit: 1000,
    });
    return listed.objects;
  }
} 