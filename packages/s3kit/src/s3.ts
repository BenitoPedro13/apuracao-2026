import { NoSuchKey, PutObjectCommand, S3ServiceException, type PutObjectCommandInput, type S3Client } from '@aws-sdk/client-s3';

export const isStatus = (err: unknown, ...codes: number[]) =>
  err instanceof S3ServiceException && codes.includes(err.$metadata.httpStatusCode ?? 0);

export const isNotFound = (err: unknown) => err instanceof NoSuchKey || isStatus(err, 404);

/**
 * Write-once put (architecture.md §7.5): `If-None-Match: *`. A 412 means the key already
 * exists, which for content-addressed keys is success: that's dedup and idempotency in one
 * header.
 */
export async function putOnce(s3: S3Client, input: PutObjectCommandInput): Promise<'stored' | 'exists'> {
  try {
    await s3.send(new PutObjectCommand({ ...input, IfNoneMatch: '*' }));
    return 'stored';
  } catch (err) {
    if (isStatus(err, 412)) return 'exists';
    throw err;
  }
}
