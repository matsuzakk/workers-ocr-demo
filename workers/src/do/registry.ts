import type { Env } from "../env";

const STORAGE_KEY = "job_ids";
const MAX_IDS = 500;
/** 単一インスタンス用（`idFromName` は固定） */
export const REGISTRY_DO_NAME = "job-id-registry";

/**
 * ジョブ ID の一覧だけを保持する DO（OcrJobDo は列挙できないため）
 */
export class JobRegistryDo {
  constructor(
    public readonly ctx: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/append" && request.method === "POST") {
      return this.append(request);
    }
    if (path === "/list" && request.method === "GET") {
      return this.list();
    }
    return new Response("Not found", { status: 404 });
  }

  private async readIds(): Promise<string[]> {
    const ids = await this.ctx.storage.get<string[]>(STORAGE_KEY);
    return Array.isArray(ids) ? ids : [];
  }

  private async append(request: Request): Promise<Response> {
    let body: { jobId?: string };
    try {
      body = (await request.json()) as { jobId?: string };
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const jobId = body.jobId?.trim();
    if (!jobId) {
      return new Response("jobId required", { status: 400 });
    }
    const prev = await this.readIds();
    const without = prev.filter((id) => id !== jobId);
    const next = [jobId, ...without].slice(0, MAX_IDS);
    await this.ctx.storage.put(STORAGE_KEY, next);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async list(): Promise<Response> {
    const jobIds = await this.readIds();
    return new Response(JSON.stringify({ jobIds }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
