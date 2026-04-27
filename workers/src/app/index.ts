import { Hono } from "hono";
import { cors } from "hono/cors";
import { REGISTRY_DO_NAME } from "../do/registry";
import type { JobState } from "../do/types";
import type { Env } from "../env";

const DO_BASE = "https://do.internal";

function doUrl(p: `/${string}`): string {
  return `${DO_BASE}${p}`;
}

/** クライアントがそのまま img src に使える絶対 URL */
function publicCaptureUrl(reqUrl: string, jobId: string): string {
  const path = `/jobs/${encodeURIComponent(jobId)}/capture`;
  return new URL(path, reqUrl).href;
}

export function buildApp() {
  /** OCR ジョブ DO スタブ */
  const jobStub = (env: Env, jobId: string) =>
    env.OCR_JOBS.get(env.OCR_JOBS.idFromName(jobId));
  /** ジョブ一覧 DO スタブ */
  const registryStub = (env: Env) =>
    env.JOB_REGISTRY.get(env.JOB_REGISTRY.idFromName(REGISTRY_DO_NAME));

  /** アプリケーション */
  const app = new Hono<{ Bindings: Env }>();
  app.use("/*", cors());
  app.get("/health", (c) => c.json({ ok: true, service: "workers-ocr-demo" }));
  /**
   * 画像を受け取り、ジョブを作成して OCR を実行
   */
  app.post("/captures", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(
        { error: "multipart/form-data で file を送ってください" },
        400,
      );
    }
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return c.json(
        { error: "file フィールド（画像ファイル）が必要です" },
        400,
      );
    }
    const jobId = crypto.randomUUID();
    const r2Key = `captures/${jobId}/original`;
    const stub = jobStub(c.env, jobId);
    // ジョブを初期化(作成)して DO に登録
    const init = await stub.fetch(
      new Request(doUrl("/init"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, r2Key }),
      }),
    );
    if (!init.ok) {
      const t = await init.text();
      return c.json({ error: "ジョブ初期化に失敗しました", detail: t }, 500);
    }

    // 画像を R2 に保存
    const buf = await file.arrayBuffer();
    await c.env.CAPTURES.put(r2Key, buf, {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });

    const regStub = c.env.JOB_REGISTRY.get(
      c.env.JOB_REGISTRY.idFromName(REGISTRY_DO_NAME),
    );
    const appendRes = await regStub.fetch(
      new Request(doUrl("/append"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      }),
    );
    if (!appendRes.ok) {
      const t = await appendRes.text();
      return c.json(
        { error: "ジョブ一覧用ストアへの登録に失敗しました", detail: t },
        500,
      );
    }

    // キューにメッセージを送信
    try {
      await c.env.OCR_QUEUE.send({ jobId, r2Key });
    } catch {
      return c.json(
        {
          error:
            "Queue への登録に失敗しました。wrangler 設定を確認してください。",
        },
        500,
      );
    }
    return c.json({ jobId, r2Key });
  });

  /**
   * ジョブに紐づくキャプチャ画像（R2）
   */
  app.get("/jobs/:jobId/capture", async (c) => {
    const jobId = c.req.param("jobId");
    const jr = await jobStub(c.env, jobId).fetch(
      new Request(doUrl("/http"), { method: "GET" }),
    );
    if (!jr.ok) {
      return c.json({ error: "job not found" }, 404);
    }
    const s = (await jr.json()) as JobState;
    if (!s.r2Key) {
      return c.json({ error: "capture not available" }, 404);
    }
    const obj = await c.env.CAPTURES.get(s.r2Key);
    if (!obj) {
      return c.json({ error: "image not found" }, 404);
    }
    const ct = obj.httpMetadata?.contentType ?? "application/octet-stream";
    return new Response(obj.body, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=120",
      },
    });
  });

  /**
   * ジョブ一覧（レジストリ DO が保持する ID 順。状態は各ジョブ DO から取得）
   */
  app.get("/jobs", async (c) => {
    const lr = await registryStub(c.env).fetch(
      new Request(doUrl("/list"), { method: "GET" }),
    );
    if (!lr.ok) {
      const t = await lr.text();
      return c.json(
        { error: "ジョブ一覧の取得に失敗しました", detail: t },
        500,
      );
    }
    const { jobIds } = (await lr.json()) as { jobIds: string[] };

    const jobs = await Promise.all(
      jobIds.map(async (jid) => {
        const r = await jobStub(c.env, jid).fetch(
          new Request(doUrl("/http"), { method: "GET" }),
        );
        if (!r.ok) {
          return {
            jobId: jid,
            createdAt: 0,
            updatedAt: 0,
            status: "missing" as const,
            error: "ジョブ状態を取得できませんでした",
            captureUrl: null,
          };
        }
        const s = (await r.json()) as JobState;
        return {
          jobId: s.jobId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          status: s.status,
          error: s.error,
          captureUrl: s.r2Key ? publicCaptureUrl(c.req.url, s.jobId) : null,
        };
      }),
    );

    return c.json({ jobs });
  });

  /**
   * ジョブの状態を取得
   */
  app.get("/jobs/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    const r = await jobStub(c.env, jobId).fetch(
      new Request(doUrl("/http"), { method: "GET" }),
    );
    if (r.status === 404) {
      return c.json({ error: "job not found" }, 404);
    }
    if (!r.ok) {
      const t = await r.text();
      return c.json({ error: "ジョブの取得に失敗しました", detail: t }, 502);
    }
    const s = (await r.json()) as JobState;
    const captureUrl = s.r2Key ? publicCaptureUrl(c.req.url, jobId) : null;
    return c.json({ ...s, captureUrl });
  });

  /**
   * ジョブの WebSocket 接続
   */
  app.get("/jobs/:jobId/ws", async (c) => {
    const jobId = c.req.param("jobId");
    const raw = c.req.raw;
    const u = new URL(c.req.url);
    const w = new URL(doUrl("/ws"));
    w.search = u.search;
    return jobStub(c.env, jobId).fetch(
      new Request(w, { method: "GET", headers: raw.headers }),
    );
  });

  type BookInput = {
    jobId: string;
    title?: string;
    author?: string;
    isbn?: string;
  };

  /**
   * 承認済みメタデータ＋`jobId`（OCR ジョブとのリンク）。
   * D1 保存カラムは最小例: `id`, `job_id`, `title`, `author`, `isbn`（null 可）, `created_at` 等
   */
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
      new Request(doUrl("/http"), { method: "GET" }),
    );
    if (sres.status === 404) {
      return c.json({ error: "job not found" }, 404);
    }
    const j = (await sres.json()) as { status: string };
    if (j.status !== "done") {
      return c.json(
        { error: "OCR 完了前の job は承認・登録できません", status: j.status },
        400,
      );
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const title = body.title?.trim() || null;
    const author = body.author?.trim() || null;
    const isbn = body.isbn?.trim() || null;
    try {
      await c.env.DB.prepare(
        "INSERT INTO books (id, job_id, title, author, isbn, created_at) VALUES (?, ?, ?, ?, ?, ?)",
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
