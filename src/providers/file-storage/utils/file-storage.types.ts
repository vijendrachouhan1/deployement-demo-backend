export interface IUploadFile {
  key: string;
  buffer: Buffer;
  mimeType: string;
  bucket?: string;
}

export interface IPreSignedUrlOptions {
  expiresIn?: number;
  operation?: "put" | "get";
  downloadFilename?: string;
}

export interface IPreSignedUrl {
  url: string;
  keyFile: string;
}

export interface IUploadProvider {
  upload(file: IUploadFile): Promise<{ key: string }>;
  uploadMany(files: IUploadFile[]): Promise<{ key: string }[]>;
  delete(key: string): Promise<void>;
  getPreSignedUrl(
    key: string,
    mimeType: string,
    options?: IPreSignedUrlOptions,
  ): Promise<IPreSignedUrl>;
}
