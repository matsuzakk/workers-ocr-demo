/**
 * Amazon.co.jp 上の本を探す（HTML スクレイピングなし）。
 *
 * Google Programmable Search Engine（Custom Search JSON API）のみ使用。
 * クエリに "amazon" を付与し、siteSearch で amazon.co.jp に限定する。
 *
 * 事前準備:
 * 1. Google Cloud で「Custom Search API」を有効化し API キーを発行 → GOOGLE_CSE_API_KEY
 * 2. https://programmablesearchengine.google.com/ で検索エンジンを作成し「検索エンジン ID」→ GOOGLE_CSE_CX
 */

import type { Env } from "../../env";

const CSE_URL = "https://www.googleapis.com/customsearch/v1";

export type AmazonJpWebSearchHit = {
  title: string;
  link: string;
  snippet: string;
  /** /dp/ セグメントが ISBN-10 形式のときのみ */
  isbn10_from_url?: string;
};

type CseItem = {
  title?: string;
  link?: string;
  snippet?: string;
};

function isbn10FromAmazonUrl(link: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(link).pathname;
  } catch {
    return undefined;
  }
  const m = pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
  const seg = m?.[1];
  if (!seg) return undefined;
  if (!/^(\d{9}[\dX]|\d{10})$/i.test(seg)) return undefined;
  return seg.toUpperCase();
}

/**
 * Web 検索（amazon.co.jp 限定）で書誌候補を返す。返却は LLM ツール向けのフラットな JSON。
 */
export async function searchAmazonJpBooksViaWebSearch(
  env: Pick<Env, "GOOGLE_CSE_API_KEY" | "GOOGLE_CSE_CX">,
  keywords: string,
): Promise<Record<string, unknown>> {
  const apiKey = env.GOOGLE_CSE_API_KEY?.trim();
  const cx = env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) {
    return { error: "missing_google_cse_credentials", results: [] };
  }

  const base = keywords.trim();
  if (!base) {
    return { error: "empty_keywords", results: [] };
  }

  const q = `${base} amazon`.replace(/\s+/g, " ").trim();

  const url = new URL(CSE_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", q);
  url.searchParams.set("num", "10");
  url.searchParams.set("siteSearch", "amazon.co.jp");
  url.searchParams.set("siteSearchFilter", "i");

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      return {
        error: `http_${res.status}`,
        query: q,
        results: [] as AmazonJpWebSearchHit[],
      };
    }

    const data = (await res.json()) as { items?: CseItem[] };
    const items = data.items ?? [];

    const results: AmazonJpWebSearchHit[] = items.map((it) => {
      const title = it.title ?? "";
      const link = it.link ?? "";
      const snippet = it.snippet ?? "";
      const isbn10 = isbn10FromAmazonUrl(link);
      return isbn10
        ? { title, link, snippet, isbn10_from_url: isbn10 }
        : { title, link, snippet };
    });

    return {
      source: "google_custom_search_amazon_co_jp",
      query: q,
      results,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg, query: q, results: [] as AmazonJpWebSearchHit[] };
  }
}
