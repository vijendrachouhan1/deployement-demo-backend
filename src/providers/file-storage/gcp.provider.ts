import {
  IUploadFile,
  IPreSignedUrlOptions,
  IUploadProvider,
  IPreSignedUrl,
} from "@/providers/file-storage/utils/file-storage.types";

export class GCPProvider implements IUploadProvider {
  async upload(_file: IUploadFile): Promise<{ key: string }> {
    throw new Error("GCPProvider.upload() not implemented");
  }

  async uploadMany(_files: IUploadFile[]): Promise<{ key: string }[]> {
    throw new Error("GCPProvider.uploadMany() not implemented");
  }

  async delete(_key: string): Promise<void> {
    throw new Error("GCPProvider.delete() not implemented");
  }

  async getPreSignedUrl(
    _key: string,
    _mimeType: string,
    _options?: IPreSignedUrlOptions,
  ): Promise<IPreSignedUrl> {
    throw new Error("GCPProvider.getPreSignedUrl() not implemented");
  }
}
