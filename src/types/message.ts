/** Queue に投入する非同期 OCR 用メッセージ */
export type OcrQueueMessage = {
  jobId: string;
  r2Key: string;
};

/** Queueのジョブ状態 */
export type JobStatus = "pending" | "processing" | "done" | "error";

/** クライアント向け（GET /jobs/:id） */
export type JobState = {
  jobId: string;
  r2Key: string | null;
  status: JobStatus;
  ocrText: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};
