import type { OcrQueueMessage } from "./queue/types";

export type Env = {
  OCR_QUEUE: Queue<OcrQueueMessage>;
  OCR_JOBS: DurableObjectNamespace;
  /** ジョブ ID 一覧（単一 DO） */
  JOB_REGISTRY: DurableObjectNamespace;
  AI: Ai;
  CAPTURES: R2Bucket;
  DB: D1Database;
  /** Google Books API key */
  GOOGLE_BOOKS_API_KEY?: string;
  /** Google Custom Search JSON API key（Programmable Search・Amazon JP enrich 用） */
  GOOGLE_CSE_API_KEY?: string;
  /** Programmable Search Engine の検索エンジン ID（cx） */
  GOOGLE_CSE_CX?: string;
};
