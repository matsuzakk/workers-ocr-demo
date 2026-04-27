"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "upload" | "jobs";

type JobRow = {
  jobId: string;
  createdAt: number;
  updatedAt: number;
  status: string;
  error: string | null;
  captureUrl: string | null;
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
    case "missing":
      return "取得失敗";
    default:
      return status;
  }
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsErr, setJobsErr] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const base = workerBase();
    if (!base) {
      setJobsErr("NEXT_PUBLIC_WORKER_URL が未設定です。");
      return;
    }
    setJobsErr(null);
    setJobsLoading(true);
    try {
      const r = await fetch(`${base}/jobs`);
      const j = (await r.json()) as { jobs?: JobRow[]; error?: string };
      if (!r.ok) {
        setJobsErr(j.error ?? `HTTP ${r.status}`);
        setJobs([]);
        return;
      }
      setJobs(j.jobs ?? []);
    } catch (e) {
      setJobsErr(e instanceof Error ? e.message : String(e));
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "jobs") return;
    const t = window.setTimeout(() => {
      void loadJobs();
    }, 0);
    return () => window.clearTimeout(t);
  }, [tab, loadJobs]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  const updateSelectedFile = useCallback((next: File | null) => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    if (next) {
      const url = URL.createObjectURL(next);
      previewObjectUrlRef.current = url;
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
    setFile(next);
  }, []);

  const clearSelectedFile = useCallback(() => {
    updateSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [updateSelectedFile]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadMsg(null);
    setUploadErr(null);
    const base = workerBase();
    if (!base) {
      setUploadErr("NEXT_PUBLIC_WORKER_URL が未設定です。");
      return;
    }
    if (!file) {
      setUploadErr("画像ファイルを選んでください。");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${base}/captures`, { method: "POST", body: fd });
      const j = (await r.json()) as { jobId?: string; error?: string };
      if (!r.ok) {
        setUploadErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setUploadMsg(`ジョブを受け付けました。ID: ${j.jobId ?? "(なし)"}`);
      clearSelectedFile();
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-900">
      <h1 className="mb-4 text-xl font-semibold">📸 OCR デモ サンプル</h1>

      <div
        className="mb-6 inline-flex rounded-xl bg-gray-100 p-1 ring-1 ring-gray-200/80"
        role="tablist"
        aria-label="画面の切り替え"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upload"}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 ${
            tab === "upload"
              ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/80"
              : "text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("upload")}
        >
          画像アップロード
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "jobs"}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 ${
            tab === "jobs"
              ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/80"
              : "text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("jobs")}
        >
          ジョブ一覧
        </button>
      </div>

      {/* 画像アップロード */}
      {tab === "upload" && (
        <section className="rounded-2xl border border-gray-200/90 bg-linear-to-b from-white to-gray-50/90 p-6 shadow-sm ring-1 ring-gray-100">
          <form className="space-y-5" onSubmit={onUpload}>
            <div className="space-y-2">
              <label
                htmlFor="upload-image"
                className="block text-sm font-medium text-gray-800"
              >
                画像ファイル
              </label>
              <input
                ref={fileInputRef}
                id="upload-image"
                type="file"
                accept="image/*"
                className="block w-full cursor-pointer text-sm text-gray-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-gray-900 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white file:shadow-sm file:transition-colors hover:file:bg-gray-800"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  updateSelectedFile(f ?? null);
                }}
              />
            </div>

            <div className="relative overflow-hidden rounded-xl border border-gray-200/90 bg-gray-50/80 ring-1 ring-inset ring-gray-100">
              {previewUrl ? (
                <>
                  <button
                    type="button"
                    onClick={clearSelectedFile}
                    className="absolute right-2 top-2 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/95 text-gray-600 shadow-md ring-1 ring-gray-200/90 backdrop-blur-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
                    aria-label="選択を解除"
                  >
                    <svg
                      className="size-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                  <img
                    src={previewUrl}
                    alt="選択した画像のプレビュー"
                    className="mx-auto max-h-72 w-full object-contain"
                  />
                </>
              ) : (
                <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                  <span
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-200/80 text-gray-500"
                    aria-hidden
                  >
                    <svg
                      className="h-6 w-6"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                      />
                    </svg>
                  </span>
                  <p className="text-sm text-gray-500">
                    画像を選ぶとプレビューが表示されます
                  </p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!file || uploading}
              className="inline-flex w-full items-center justify-center rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-gray-900 sm:w-auto sm:min-w-40"
            >
              {uploading ? "送信中…" : "アップロード"}
            </button>
          </form>
          {uploadMsg && (
            <p className="mt-4 text-sm font-medium text-emerald-800">
              {uploadMsg}
            </p>
          )}
          {uploadErr && (
            <p className="mt-4 text-sm font-medium text-red-700">{uploadErr}</p>
          )}
        </section>
      )}

      {/* ジョブ一覧 */}
      {tab === "jobs" && (
        <section className="space-y-3">
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void loadJobs()}
              disabled={jobsLoading}
            >
              <svg
                className={`h-4 w-4 shrink-0 text-gray-600 ${jobsLoading ? "animate-spin" : ""}`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              {jobsLoading ? "読み込み中…" : "更新"}
            </button>
            {jobsErr && (
              <span className="max-w-full text-right text-sm text-red-700">
                {jobsErr}
              </span>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-sm ring-1 ring-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full min-w-lg border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200/90 bg-gray-50/90">
                    <th className="px-3 py-2.5 font-medium text-gray-800">
                      画像
                    </th>
                    <th className="px-3 py-2.5 font-medium text-gray-800">
                      ジョブ ID
                    </th>
                    <th className="px-3 py-2.5 font-medium text-gray-800">
                      状態
                    </th>
                    <th className="px-3 py-2.5 font-medium text-gray-800">
                      作成
                    </th>
                    <th className="px-3 py-2.5 font-medium text-gray-800">
                      更新
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length === 0 && !jobsLoading && (
                    <tr>
                      <td
                        className="px-3 py-8 text-center text-gray-500"
                        colSpan={5}
                      >
                        ジョブがありません。
                      </td>
                    </tr>
                  )}
                  {jobs.map((j) => (
                    <tr
                      key={j.jobId}
                      className="border-b border-gray-100 last:border-b-0"
                    >
                      <td className="px-3 py-2.5 align-middle">
                        {j.captureUrl ? (
                          <img
                            src={j.captureUrl}
                            alt=""
                            className="h-14 max-w-24 rounded-md border border-gray-200/90 object-contain"
                          />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          className="font-medium text-blue-700 underline-offset-2 hover:underline"
                          href={`/jobs/${j.jobId}`}
                        >
                          {j.jobId}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-gray-800">
                        {statusLabel(j.status)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                        {j.createdAt
                          ? new Date(j.createdAt).toLocaleString("ja-JP")
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                        {j.updatedAt
                          ? new Date(j.updatedAt).toLocaleString("ja-JP")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            エラー内容はジョブ ID をクリックして詳細で確認できます。
          </p>
        </section>
      )}
    </main>
  );
}
