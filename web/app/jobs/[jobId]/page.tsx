"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type JobDetail = {
  jobId: string;
  r2Key: string | null;
  status: string;
  ocrText: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

function workerBase(): string {
  const b = process.env.NEXT_PUBLIC_WORKER_URL ?? "";
  return b.replace(/\/$/, "");
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待機";
    case "processing":
      return "処理中";
    case "done":
      return "完了";
    case "error":
      return "エラー";
    default:
      return status;
  }
}

export default function JobDetailPage() {
  const params = useParams();
  const jobId = typeof params.jobId === "string" ? params.jobId : "";
  const invalidId = jobId.length === 0;

  const [data, setData] = useState<JobDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!invalidId);

  useEffect(() => {
    if (invalidId) return;

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      const base = workerBase();
      if (!base) {
        if (!cancelled) {
          setErr("NEXT_PUBLIC_WORKER_URL が未設定です。");
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setErr(null);
      }
      try {
        const r = await fetch(`${base}/jobs/${jobId}`);
        const j = (await r.json()) as JobDetail & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setData(null);
          setErr(j.error ?? `HTTP ${r.status}`);
          return;
        }
        setData(j);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, invalidId]);

  return (
    <main className="mx-auto max-w-2xl p-6 text-gray-900">
      <p className="mb-4 text-sm">
        <Link className="text-blue-700 underline" href="/">
          ← トップへ
        </Link>
      </p>

      <h1 className="mb-4 text-xl font-semibold">ジョブ詳細</h1>

      {invalidId && (
        <p className="text-sm text-red-700">ジョブ ID がありません。</p>
      )}

      {!invalidId && loading && (
        <p className="text-sm text-gray-600">読み込み中…</p>
      )}
      {!invalidId && err && !loading && (
        <p className="text-sm text-red-700">{err}</p>
      )}

      {!invalidId && data && !loading && (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium text-gray-700">ジョブ ID</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{data.jobId}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">状態</dt>
            <dd className="mt-0.5">{statusLabel(data.status)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">作成日時</dt>
            <dd className="mt-0.5">
              {new Date(data.createdAt).toLocaleString("ja-JP")}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">更新日時</dt>
            <dd className="mt-0.5">
              {new Date(data.updatedAt).toLocaleString("ja-JP")}
            </dd>
          </div>
          {data.r2Key && (
            <div>
              <dt className="font-medium text-gray-700">R2 キー</dt>
              <dd className="mt-0.5 break-all font-mono text-xs">
                {data.r2Key}
              </dd>
            </div>
          )}
          {data.error && (
            <div>
              <dt className="font-medium text-gray-700">エラー</dt>
              <dd className="mt-0.5 whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-2 text-red-900">
                {data.error}
              </dd>
            </div>
          )}
          {data.ocrText && (
            <div>
              <dt className="font-medium text-gray-700">OCR 結果</dt>
              <dd className="mt-0.5">
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 text-xs">
                  {data.ocrText}
                </pre>
              </dd>
            </div>
          )}
        </dl>
      )}
    </main>
  );
}
