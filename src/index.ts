import { buildApp } from "./app";
import type { Env } from "./env";
import { runOcr } from "./ocr";
import type { OcrQueueMessage } from "./types/message";

export { OcrJob } from "./ocr-job";

const app = buildApp();

const DO = "https://do.internal";
function durl(p: `/${string}`) {
  return `${DO}${p}`;
}

const jobStub = (env: Env, jobId: string) =>
  env.OCR_JOBS.get(env.OCR_JOBS.idFromName(jobId));

const handler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const m of batch.messages) {
      const { jobId, r2Key } = m.body as OcrQueueMessage;
      const stub = jobStub(env, jobId);
      const pr = await stub.fetch(
        new Request(durl("/internal/processing"), { method: "POST" }),
      );
      if (!pr.ok) {
        m.retry();
        continue;
      }
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
      const bytes = await obj.arrayBuffer();
      let text: string;
      try {
        text = await runOcr(env, bytes);
        if (!text) {
          text = "(OCR 結果が空でした。画像の解像度・内容をご確認ください)";
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
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
  },
} satisfies ExportedHandler<Env>;

export default handler;
