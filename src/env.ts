import type { OcrQueueMessage } from "./types/message";

export type Env = {
  OCR_QUEUE: Queue<OcrQueueMessage>;
  OCR_JOBS: DurableObjectNamespace;
  AI: Ai;
  CAPTURES: R2Bucket;
  DB: D1Database;
};
