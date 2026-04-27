import type { Env } from "../env";
import type { OcrQueueMessage } from "../types/message";
import { enrichOcrDraftWithCatalogTools, runOcr } from "./ai";

/**
 * Durable Object への `stub.fetch` 用。実ホストは使わず、パスルーティング用のダミー。
 * 各 DO 内の `fetch` は `url.pathname` で内部 API を分岐する。
 */
const DO_ORIGIN = "https://do.internal";
function durl(path: `/${string}`) {
  return `${DO_ORIGIN}${path}`;
}

export async function processMessageBatch(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const m of batch.messages) {
    const { jobId, r2Key } = m.body as OcrQueueMessage;
    // ジョブ ID から DO スタブを取得
    const stub = env.OCR_JOBS.get(env.OCR_JOBS.idFromName(jobId));

    // ジョブのステータスを `processing` に遷移させる
    const pr = await stub.fetch(
      new Request(durl("/internal/processing"), { method: "POST" }),
    );
    if (!pr.ok) {
      m.retry();
      continue;
    }

    // R2 から `r2Key` で画像オブジェクトを取り出す
    const obj = await env.CAPTURES.get(r2Key);
    if (!obj) {
      await stub.fetch(
        new Request(durl("/internal/fail"), {
          method: "POST",
          body: JSON.stringify({ error: "R2 オブジェクトが見つかりません" }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      m.ack();
      continue;
    }

    // 画像オブジェクトをバイト列に変換して OCRによる画像解析を実行
    const bytes = await obj.arrayBuffer();
    const imageMime = obj.httpMetadata?.contentType ?? null;
    let text: string;
    try {
      // Workers AI による OCR を実行
      const draft = await runOcr(env, bytes, imageMime);
      console.log("draft", draft);
      text = draft;
      if (!text) {
        text = "(OCR 結果が空でした。画像の解像度・内容をご確認ください)";
      } else {
        try {
          text = await enrichOcrDraftWithCatalogTools(env, draft);
          console.log("enriched", text);
        } catch {
          text = draft;
        }
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // 失敗なら `/internal/fail` で `error` を保存し、DO を `error` に遷移させる
      await stub.fetch(
        new Request(durl("/internal/fail"), {
          method: "POST",
          body: JSON.stringify({ error: err }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      m.ack();
      continue;
    }

    // 成功なら `/internal/complete` で `ocrText` を保存し、DO を `done` に遷移させる
    const cr = await stub.fetch(
      new Request(durl("/internal/complete"), {
        method: "POST",
        body: JSON.stringify({ ocrText: text }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    if (!cr.ok) {
      m.retry();
      continue;
    }
    m.ack();
  }
}
