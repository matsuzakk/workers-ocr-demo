"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Tab = "upload" | "jobs";

type JobRow = {
  jobId: string;
  createdAt: number;
  updatedAt: number;
  status: string;
  error: string | null;
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
      setFile(null);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-900">
      <h1 className="mb-4 text-xl font-semibold">OCR デモ</h1>

      <div className="mb-4 flex gap-0 border-b border-gray-300 pb-2">
        <button
          type="button"
          className={`px-3 py-1 text-sm ${
            tab === "upload"
              ? "border-black bg-gray-700 text-white"
              : "border-gray-300 bg-white"
          }`}
          onClick={() => setTab("upload")}
        >
          画像アップロード
        </button>
        <button
          type="button"
          className={`px-3 py-1 text-sm ${
            tab === "jobs"
              ? "border-black bg-gray-700 text-white"
              : "border-gray-300 bg-white"
          }`}
          onClick={() => setTab("jobs")}
        >
          ジョブ一覧
        </button>
      </div>

      {/* 画像アップロード */}
      {tab === "upload" && (
        <section className="space-y-3">
          <form className="space-y-3" onSubmit={onUpload}>
            <div>
              <label className="mb-1 block text-sm font-medium">
                画像ファイル
              </label>
              <input
                type="file"
                accept="image/*"
                className="block text-sm border border-gray-300 rounded-md p-1"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  setFile(f ?? null);
                }}
              />
            </div>
            <button
              type="submit"
              disabled={uploading}
              className="rounded border border-gray-800 bg-gray-800 px-4 py-1 text-sm text-white disabled:opacity-50"
            >
              {uploading ? "送信中…" : "アップロード"}
            </button>
          </form>
          {uploadMsg && <p className="text-sm text-green-800">{uploadMsg}</p>}
          {uploadErr && <p className="text-sm text-red-700">{uploadErr}</p>}
        </section>
      )}

      {/* ジョブ一覧 */}
      {tab === "jobs" && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1 text-sm text-blue-500 underline"
              onClick={() => void loadJobs()}
              disabled={jobsLoading}
            >
              {jobsLoading ? "読み込み中…" : "更新"}
            </button>
            {jobsErr && <span className="text-sm text-red-700">{jobsErr}</span>}
          </div>

          <div className="overflow-x-auto border border-gray-300">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-300 bg-gray-50">
                  <th className="border-r border-gray-200 px-2 py-2 font-medium">
                    ジョブ ID
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2 font-medium">
                    状態
                  </th>
                  <th className="border-r border-gray-200 px-2 py-2 font-medium">
                    作成
                  </th>
                  <th className="px-2 py-2 font-medium">更新</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 && !jobsLoading && (
                  <tr>
                    <td className="px-2 py-3 text-gray-600" colSpan={4}>
                      ジョブがありません。
                    </td>
                  </tr>
                )}
                {jobs.map((j) => (
                  <tr key={j.jobId} className="border-b border-gray-200">
                    <td className="border-r border-gray-100 px-2 py-2">
                      <Link
                        className="text-blue-700 underline"
                        href={`/jobs/${j.jobId}`}
                      >
                        {j.jobId}
                      </Link>
                    </td>
                    <td className="border-r border-gray-100 px-2 py-2">
                      {statusLabel(j.status)}
                    </td>
                    <td className="border-r border-gray-100 px-2 py-2 whitespace-nowrap text-gray-700">
                      {new Date(j.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-gray-700">
                      {new Date(j.updatedAt).toLocaleString("ja-JP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            エラー内容はジョブ ID をクリックして詳細で確認できます。
          </p>
        </section>
      )}
    </main>
  );
}
