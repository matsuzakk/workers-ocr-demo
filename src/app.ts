import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";

const DO_BASE = "https://do.internal";

function doUrl(p: `/${string}`): string {
  return `${DO_BASE}${p}`;
}

export function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/*", cors());
  app.get("/health", (c) => c.json({ ok: true, service: "workers-ocr-demo" }));

  const jobStub = (env: Env, jobId: string) =>
    env.OCR_JOBS.get(env.OCR_JOBS.idFromName(jobId));

  app.get("/jobs/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    const r = await jobStub(c.env, jobId).fetch(
      new Request(doUrl("/http"), { method: "GET" })
    );
    if (r.status === 404) {
      return c.json({ error: "job not found" }, 404);
    }
    return new Response(r.body, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  });

  app.get("/jobs/:jobId/ws", async (c) => {
    const jobId = c.req.param("jobId");
    const raw = c.req.raw;
    const u = new URL(c.req.url);
    const w = new URL(doUrl("/ws"));
    w.search = u.search;
    return jobStub(c.env, jobId).fetch(
      new Request(w, { method: "GET", headers: raw.headers })
    );
  });

  app.post("/captures", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(
        { error: "multipart/form-data で file を送ってください" },
        400
      );
    }
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "file フィールド（画像ファイル）が必要です" }, 400);
    }
    const jobId = crypto.randomUUID();
    const r2Key = `captures/${jobId}/original`;
    const stub = jobStub(c.env, jobId);
    const init = await stub.fetch(
      new Request(doUrl("/init"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, r2Key }),
      })
    );
    if (!init.ok) {
      const t = await init.text();
      return c.json(
        { error: "ジョブ初期化に失敗しました", detail: t },
        500
      );
    }
    const buf = await file.arrayBuffer();
    await c.env.CAPTURES.put(r2Key, buf, {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    try {
      await c.env.OCR_QUEUE.send({ jobId, r2Key });
    } catch {
      return c.json(
        {
          error: "Queue への登録に失敗しました。wrangler 設定を確認してください。",
        },
        500
      );
    }
    return c.json({ jobId, r2Key });
  });

  type BookInput = { jobId: string; title?: string; author?: string; isbn?: string };

  app.post("/books", async (c) => {
    let body: BookInput;
    try {
      body = (await c.req.json()) as BookInput;
    } catch {
      return c.json({ error: "JSON 形式で送ってください" }, 400);
    }
    if (!body || typeof body.jobId !== "string" || !body.jobId) {
      return c.json({ error: "jobId は必須です" }, 400);
    }
    const sres = await jobStub(c.env, body.jobId).fetch(
      new Request(doUrl("/http"), { method: "GET" })
    );
    if (sres.status === 404) {
      return c.json({ error: "job not found" }, 404);
    }
    const j = (await sres.json()) as { status: string };
    if (j.status !== "done") {
      return c.json(
        { error: "OCR 完了前の job は承認・登録できません", status: j.status },
        400
      );
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const title = body.title?.trim() || null;
    const author = body.author?.trim() || null;
    const isbn = body.isbn?.trim() || null;
    try {
      await c.env.DB.prepare(
        "INSERT INTO books (id, job_id, title, author, isbn, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(id, body.jobId, title, author, isbn, now)
        .run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return c.json({ error: "D1 への登録に失敗しました", detail: m }, 500);
    }
    return c.json({ id, jobId: body.jobId });
  });

  return app;
}
