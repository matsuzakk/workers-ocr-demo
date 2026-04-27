import { buildApp } from "./app";
import type { Env } from "./env";
import { processMessageBatch } from "./queue";

// DO クラスをエクスポート
export { OcrJobDo } from "./do/job";

const app = buildApp();

const handler = {
  // Workers HTTP リクエスト
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  // Queues リクエスト
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await processMessageBatch(batch, env);
  },
} satisfies ExportedHandler<Env>;

export default handler;
