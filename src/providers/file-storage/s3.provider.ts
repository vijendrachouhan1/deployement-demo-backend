import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import envConfig from "@/config/env";
import {
  IUploadProvider,
  IUploadFile,
  IPreSignedUrlOptions,
} from "@/providers/file-storage/utils/file-storage.types";

export class S3Provider implements IUploadProvider {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.s3 = new S3Client({
      credentials: {
        accessKeyId: envConfig.AWS_USER_KEY,
        secretAccessKey: envConfig.AWS_USER_SECRET,
      },
      region: envConfig.S3_BUCKET_REGION,
    });
    this.bucket = envConfig.S3_BUCKET_NAME;
  }

  async upload(file: IUploadFile) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: file.bucket ?? this.bucket,
        Key: file.key,
        Body: file.buffer,
        ContentType: file.mimeType,
      }),
    );

    return { key: file.key };
  }

  uploadMany(files: IUploadFile[]) {
    return Promise.all(files.map((file) => this.upload(file)));
  }

  async delete(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async getPreSignedUrl(
    key: string,
    mimeType: string,
    options?: IPreSignedUrlOptions,
  ) {
    const command =
      options?.operation === "get"
        ? new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ...(options.downloadFilename && {
              ResponseContentDisposition: `attachment; filename="${options.downloadFilename}"`,
            }),
          })
        : new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: mimeType,
          });

    const url = await getSignedUrl(this.s3, command, {
      expiresIn: options?.expiresIn ?? 120,
    });

    return { url, keyFile: key };
  }
}
