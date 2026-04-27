/**
 * Google Books API v1（/volumes）を利用した書籍検索。
 * HTML スクレイピングは使わず、JSON のみ。
 *
 * API キーは `env.GOOGLE_BOOKS_API_KEY`（ローカルではプロジェクト直下の `.env` を wrangler が読み込みバインドする）。
 */

import type { Env } from "../../env";

const GOOGLE_BOOKS_VOLUMES =
  "https://www.googleapis.com/books/v1/volumes" as const;

export type GoogleBooksVolumeHit = {
  id: string;
  title: string;
  authors: string[];
  publishedDate?: string;
  description?: string;
  previewLink?: string;
  infoLink?: string;
};

type GoogleBooksVolumesResponse = {
  items?: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      authors?: string[];
      publishedDate?: string;
      description?: string;
      previewLink?: string;
      infoLink?: string;
    };
  }>;
};

const getGoogleApiKey = (
  env: Pick<Env, "GOOGLE_BOOKS_API_KEY">,
): string | undefined => env.GOOGLE_BOOKS_API_KEY?.trim() || undefined;

/**
 * Google Books API v1（/volumes）を利用した書籍検索。
 */
const fetchVolumes = async (
  apiKey: string,
  q: string,
  maxResults: number,
): Promise<Record<string, unknown>> => {
  const trimmed = q.trim();
  if (!trimmed) {
    return { error: "empty_query", results: [] as GoogleBooksVolumeHit[] };
  }

  // URL を構築
  const url = new URL(GOOGLE_BOOKS_VOLUMES);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("projection", "lite");
  url.searchParams.set("printType", "books");
  url.searchParams.set("maxResults", String(Math.min(maxResults, 40)));
  url.searchParams.set("key", apiKey);

  try {
    // Google Books API を呼び出し
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    console.log("res", res);

    // エラーハンドリング
    if (!res.ok) {
      return {
        error: `http_${res.status}`,
        query: trimmed,
        results: [] as GoogleBooksVolumeHit[],
      };
    }

    // JSON をパース
    const data = (await res.json()) as GoogleBooksVolumesResponse;
    console.log("data", data);
    // items を取得して、volumeInfo を取得して、GoogleBooksVolumeHit に変換
    const items = data.items ?? [];
    const results = items.map((item) => ({
      id: item.id,
      title: item.volumeInfo?.title,
      authors: item.volumeInfo?.authors,
      publishedDate: item.volumeInfo?.publishedDate,
      description: item.volumeInfo?.description,
      previewLink: item.volumeInfo?.previewLink,
      infoLink: item.volumeInfo?.infoLink,
    }));

    return {
      source: "google_books_api",
      query: trimmed,
      results,
      note:
        results.length === 0
          ? "No items in response (empty result set)."
          : undefined,
    };
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: msg,
      query: trimmed,
      results: [] as GoogleBooksVolumeHit[],
    };
  }
};

/**
 * `intitle:` でタイトル検索（maxResults 既定 5）。
 */
export const searchGoogleBooksByTitle = async (
  env: Pick<Env, "GOOGLE_BOOKS_API_KEY">,
  title: string,
  maxResults = 5,
): Promise<Record<string, unknown>> => {
  const apiKey = getGoogleApiKey(env);
  if (!apiKey) {
    return { error: "missing_api_key", results: [] };
  }
  const q = `intitle:${title.trim()}`;
  const result = await fetchVolumes(apiKey, q, maxResults);

  return result;
};

/**
 * `inauthor:` で著者検索（maxResults 既定 10）。
 */
export const searchGoogleBooksByAuthor = async (
  env: Pick<Env, "GOOGLE_BOOKS_API_KEY">,
  author: string,
  maxResults = 10,
): Promise<Record<string, unknown>> => {
  const apiKey = getGoogleApiKey(env);
  if (!apiKey) {
    return { error: "missing_api_key", results: [] };
  }
  const q = `inauthor:${author.trim()}`;
  const result = await fetchVolumes(apiKey, q, maxResults);

  return result;
};
