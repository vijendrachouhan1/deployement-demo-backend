import { S3Provider } from "@/providers/file-storage/s3.provider";
import { AzureProvider } from "@/providers/file-storage/azure.provider";
import { GCPProvider } from "@/providers/file-storage/gcp.provider";

import {
  IUploadFile,
  IPreSignedUrlOptions,
  IUploadProvider,
} from "@/providers/file-storage/utils/file-storage.types";
import { STORAGE_PROVIDER } from "@/providers/file-storage/utils/file-storage.enum";

export class FileStorageService {
  private provider: IUploadProvider;

  constructor() {
    this.provider = createUploadProvider(STORAGE_PROVIDER.S3);
  }

  upload(file: IUploadFile) {
    return this.provider.upload(file);
  }

  uploadMany(files: IUploadFile[]) {
    return this.provider.uploadMany(files);
  }

  delete(key: string) {
    return this.provider.delete(key);
  }

  getPreSignedUrl(
    key: string,
    mimeType: string,
    options?: IPreSignedUrlOptions,
  ) {
    return this.provider.getPreSignedUrl(key, mimeType, options);
  }
}

function createUploadProvider(
  storageProvider: STORAGE_PROVIDER = STORAGE_PROVIDER.S3,
) {
  switch (storageProvider) {
    case STORAGE_PROVIDER.AZURE:
      return new AzureProvider();
    case STORAGE_PROVIDER.GCP:
      return new GCPProvider();
    default:
      return new S3Provider();
  }
}

export const fileStorageService = new FileStorageService();
