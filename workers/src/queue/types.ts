/** Queue に投入する非同期 OCR 用メッセージ */
export type OcrQueueMessage = {
  jobId: string;
  r2Key: string;
};
