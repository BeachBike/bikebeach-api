import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';

/// Outcome of a put — the URL the FE should render. Pointing at R2's public
/// bucket / custom domain in prod, at our own /uploads/... in dev. Always
/// includes a cache-busting query string so re-uploads invalidate any
/// previously cached image.
export interface StoragePutResult {
  publicUrl: string;
}

const LOCAL_PHOTOS_DIR = join(process.cwd(), 'uploads', 'instructors');
const LOCAL_PHOTOS_PUBLIC_PREFIX = '/uploads/instructors';

/// Object-storage abstraction. Two backends, chosen at boot:
///   - **R2** (`R2_BUCKET` set) — uploads via the S3-compatible API. The
///     public URL is `${R2_PUBLIC_URL}/instructors/<key>?v=<ts>`. Recommended
///     for prod: zero egress fee at Cloudflare = cheap to serve images on
///     every page load.
///   - **local disk** (no R2 env) — writes under `/uploads/instructors/`
///     and the Nest `useStaticAssets` handler serves them. Keeps dev
///     friction low (no Cloudflare account needed) and is the test-suite
///     default.
///
/// The interface is intentionally narrow (`putInstructorPhoto`,
/// `deleteInstructorPhoto`). Add a new method per asset kind — don't expose
/// a generic `put(key, ...)` because it invites path-shaped keys that bypass
/// the backend's isolation.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly publicUrlBase: string | null;

  constructor(config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = config.get<string>('R2_BUCKET');
    const publicUrl = config.get<string>('R2_PUBLIC_URL');

    const allSet = accountId && accessKeyId && secretAccessKey && bucket && publicUrl;
    if (allSet) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        // aws-sdk-js v3.729+ defaults to adding flexible checksums
        // (`x-amz-checksum-crc32`) on every PutObject. Cloudflare R2 rejects
        // those requests — uploads fail with 400/501. Forcing both knobs to
        // WHEN_REQUIRED makes the SDK only add a checksum when the operation
        // strictly needs one (PutObject doesn't), restoring R2 compat. This
        // is Cloudflare's own documented workaround for the SDK change.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      this.bucket = bucket!;
      this.publicUrlBase = publicUrl!.replace(/\/$/, '');
      this.logger.log(`storage backend = R2 (bucket=${bucket})`);
    } else {
      this.client = null;
      this.bucket = null;
      this.publicUrlBase = null;
      this.logger.log('storage backend = local disk (R2 env not configured)');
    }
  }

  isRemote(): boolean {
    return this.client !== null;
  }

  /// Stores the instructor's portrait under the deterministic key
  /// `instructors/<userId>.<ext>`. The user id is the only path component
  /// the caller supplies → no traversal risk.
  async putInstructorPhoto(
    userId: string,
    buffer: Buffer,
    contentType: string,
    ext: 'png' | 'jpg',
  ): Promise<StoragePutResult> {
    const filename = `${userId}.${ext}`;
    const cacheBust = Date.now();

    if (this.client && this.bucket && this.publicUrlBase) {
      // R2 keeps siblings (.png vs .jpg under the same userId) around if the
      // user swaps formats. Delete both ext variants before put so the
      // public URL points at exactly one object.
      await this.deleteInstructorPhotoVariants(userId);
      const key = `instructors/${filename}`;
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      this.logger.log(`R2 put ok: ${this.bucket}/${key} (${buffer.length}B)`);
      return {
        publicUrl: `${this.publicUrlBase}/${key}?v=${cacheBust}`,
      };
    }

    // Local backend (dev/test).
    await fs.mkdir(LOCAL_PHOTOS_DIR, { recursive: true });
    await this.deleteInstructorPhotoVariants(userId);
    const fullPath = join(LOCAL_PHOTOS_DIR, filename);
    await fs.writeFile(fullPath, buffer);
    return {
      publicUrl: `${LOCAL_PHOTOS_PUBLIC_PREFIX}/${filename}?v=${cacheBust}`,
    };
  }

  /// Drops every ext variant for this user. Idempotent — safe to call when
  /// nothing exists yet.
  async deleteInstructorPhoto(userId: string): Promise<void> {
    await this.deleteInstructorPhotoVariants(userId);
  }

  private async deleteInstructorPhotoVariants(userId: string): Promise<void> {
    const variants: Array<'png' | 'jpg' | 'jpeg'> = ['png', 'jpg', 'jpeg'];
    if (this.client && this.bucket) {
      for (const ext of variants) {
        try {
          await this.client.send(
            new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: `instructors/${userId}.${ext}`,
            }),
          );
        } catch (err) {
          // R2 returns 204 for missing too — but if anything else trips, log
          // and continue so a single-variant cleanup doesn't break the flow.
          this.logger.warn(
            `R2 delete failed for instructors/${userId}.${ext}: ${(err as Error).message}`,
          );
        }
      }
      return;
    }
    for (const ext of variants) {
      const fullPath = join(LOCAL_PHOTOS_DIR, `${userId}.${ext}`);
      try {
        await fs.unlink(fullPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`unlink failed for ${fullPath}: ${(err as Error).message}`);
        }
      }
    }
  }
}
