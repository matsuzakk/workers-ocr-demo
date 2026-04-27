import type { Env } from "../env";
import type { JobState } from "./types";

const STORAGE_KEY = "state";

/**
 * ジョブ 1 件につき 1 インスタンス（`idFromName(jobId)`）
 */
export class OcrJobDo {
  private state: JobState | null = null;
  private websockets: Set<WebSocket> = new Set();

  constructor(
    public readonly ctx: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init" && request.method === "POST") {
      return this.handleInit(request);
    }
    if (path === "/http" && request.method === "GET") {
      return this.handleGetHttp();
    }
    if (path === "/ws" && request.method === "GET") {
      return this.handleWebSocket(request);
    }
    if (path === "/internal/processing" && request.method === "POST") {
      return this.setProcessing();
    }
    if (path === "/internal/complete" && request.method === "POST") {
      return this.handleComplete(request);
    }
    if (path === "/internal/fail" && request.method === "POST") {
      return this.handleFail(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private isWebSocketRequest(request: Request): boolean {
    return (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
  }

  private async load(): Promise<JobState | null> {
    if (this.state) return this.state;
    const raw = await this.ctx.storage.get<JobState>(STORAGE_KEY);
    this.state = raw ?? null;
    return this.state;
  }

  private async save(s: JobState): Promise<void> {
    this.state = s;
    await this.ctx.storage.put(STORAGE_KEY, s);
  }

  private now(): number {
    return Date.now();
  }

  /**
   * ジョブを初期化
   */
  private async handleInit(request: Request): Promise<Response> {
    let body: { jobId: string; r2Key: string };
    try {
      body = (await request.json()) as { jobId: string; r2Key: string };
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body.jobId || !body.r2Key) {
      return new Response("jobId and r2Key required", { status: 400 });
    }
    const existing = await this.load();
    if (existing) {
      return new Response("Job already exists", { status: 409 });
    }
    const t = this.now();
    const s: JobState = {
      jobId: body.jobId,
      r2Key: body.r2Key,
      status: "pending",
      ocrText: null,
      error: null,
      createdAt: t,
      updatedAt: t,
    };
    await this.save(s);
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * ジョブの状態を取得
   */
  private async handleGetHttp(): Promise<Response> {
    const s = await this.load();
    if (!s) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(JSON.stringify(s), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * ジョブのステータスを `processing` に遷移させる
   */
  private async setProcessing(): Promise<Response> {
    const s = await this.load();
    if (!s) {
      return new Response("Not found", { status: 404 });
    }
    s.status = "processing";
    s.updatedAt = this.now();
    await this.save(s);
    return new Response(JSON.stringify({ ok: true }));
  }

  /**
   * ジョブのステータスを `done` に遷移させる
   */
  private async handleComplete(request: Request): Promise<Response> {
    let ocrText: string;
    try {
      const j = (await request.json()) as { ocrText: string };
      ocrText = j.ocrText;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (ocrText == null) {
      return new Response("ocrText required", { status: 400 });
    }
    const s = await this.load();
    if (!s) {
      return new Response("Not found", { status: 404 });
    }
    s.status = "done";
    s.ocrText = ocrText;
    s.error = null;
    s.updatedAt = this.now();
    await this.save(s);
    await this.broadcast(
      JSON.stringify({ type: "status", state: s } satisfies {
        type: "status";
        state: JobState;
      }),
    );
    return new Response(JSON.stringify({ ok: true }));
  }

  /**
   * ジョブのステータスを `error` に遷移させる
   */
  private async handleFail(request: Request): Promise<Response> {
    let err: string;
    try {
      const j = (await request.json()) as { error: string };
      err = j.error;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (err == null) {
      return new Response("error required", { status: 400 });
    }
    const s = await this.load();
    if (!s) {
      return new Response("Not found", { status: 404 });
    }
    s.status = "error";
    s.error = err;
    s.updatedAt = this.now();
    await this.save(s);
    await this.broadcast(
      JSON.stringify({ type: "status", state: s } satisfies {
        type: "status";
        state: JobState;
      }),
    );
    return new Response(JSON.stringify({ ok: true }));
  }

  /**
   * WebSocket 接続
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    if (!this.isWebSocketRequest(request)) {
      return new Response("expected Upgrade: websocket", { status: 426 });
    }
    const s = await this.load();
    if (!s) {
      return new Response("Not found", { status: 404 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]] as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["update"]);
    this.websockets.add(server);
    if (s.status === "done" || s.status === "error") {
      server.send(
        JSON.stringify({ type: "status", state: s } satisfies {
          type: "status";
          state: JobState;
        }),
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * WebSocket メッセージを送信
   */
  private async broadcast(msg: string): Promise<void> {
    for (const ws of this.websockets) {
      try {
        ws.send(msg);
      } catch {
        this.websockets.delete(ws);
      }
    }
  }

  // Durable Object WebSocket: 接続先からの制御
  webSocketMessage(
    _ws: WebSocket,
    _message: string | ArrayBuffer,
  ): void | Promise<void> {}

  webSocketClose(ws: WebSocket): void {
    this.websockets.delete(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.websockets.delete(ws);
  }
}
