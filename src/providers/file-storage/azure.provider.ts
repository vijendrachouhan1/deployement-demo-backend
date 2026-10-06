import {
  IUploadFile,
  IPreSignedUrlOptions,
  IUploadProvider,
  IPreSignedUrl,
} from "@/providers/file-storage/utils/file-storage.types";

export class AzureProvider implements IUploadProvider {
  async upload(_file: IUploadFile): Promise<{ key: string }> {
    throw new Error("AzureProvider.upload() not implemented");
  }

  async uploadMany(_files: IUploadFile[]): Promise<{ key: string }[]> {
    throw new Error("AzureProvider.uploadMany() not implemented");
  }

  async delete(_key: string): Promise<void> {
    throw new Error("AzureProvider.delete() not implemented");
  }

  async getPreSignedUrl(
    _key: string,
    _mimeType: string,
    _options?: IPreSignedUrlOptions,
  ): Promise<IPreSignedUrl> {
    throw new Error("AzureProvider.getPreSignedUrl() not implemented");
  }
}
