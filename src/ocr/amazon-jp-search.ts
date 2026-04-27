/**
 * Amazon.co.jp の書籍カテゴリ検索ページを取得し、検索結果スニペットを抽出する。
 * HTML はサイトの変更で壊れうるため、複数パターンでタイトルを拾う。
 */

export type AmazonJpSearchHit = {
  rank: number;
  asin: string;
  title: string;
  product_url: string;
  /** /dp/ が ISBN10 形式のとき */
  isbn10_from_url?: string;
};

const AMAZON_SEARCH_BASE = "https://www.amazon.co.jp/s";

function buildSearchUrl(keywords: string): string {
  const k = keywords.trim();
  const u = new URL(AMAZON_SEARCH_BASE);
  u.searchParams.set("k", k);
  u.searchParams.set("i", "stripbooks");
  return u.toString();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function looksLikeIsbn10(s: string): boolean {
  return /^(\d{9}[\dXx]|[\d]{10})$/.test(s);
}

function pickTitleFromResultBlock(block: string): string {
  const patterns: RegExp[] = [
    /class="[^"]*a-color-base[^"]*a-text-normal[^"]*"[^>]*>([^<]+)</,
    /class="[^"]*a-text-normal[^"]*a-color-base[^"]*"[^>]*>([^<]+)</,
    /<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{2,512})</,
    /<h2[^>]*>[\s\S]*?<span[^>]*>([^<]{2,512})<\/span>/,
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m?.[1]) {
      const t = decodeHtmlEntities(m[1].trim());
      if (t.length >= 2 && !/^スポンサー/.test(t) && t !== "画像はありません") {
        return t;
      }
    }
  }
  return "";
}

function parseSearchResultsHtml(html: string, limit: number): AmazonJpSearchHit[] {
  const hits: AmazonJpSearchHit[] = [];
  const seen = new Set<string>();

  if (
    html.includes("validateCaptcha") ||
    html.includes("api-services-support@amazon.co.jp")
  ) {
    return hits;
  }

  let pos = 0;
  let rank = 0;
  while (hits.length < limit) {
    const i = html.indexOf('data-component-type="s-search-result"', pos);
    if (i === -1) break;
    const j = html.indexOf('data-component-type="s-search-result"', i + 20);
    const block = j === -1 ? html.slice(i, i + 15000) : html.slice(i, j);

    const asinMatch = block.match(/\bdata-asin="([A-Z0-9]{10})"/);
    if (!asinMatch) {
      pos = i + 20;
      continue;
    }
    const asin = asinMatch[1];
    if (!asin || asin === "0000000000" || seen.has(asin)) {
      pos = i + 20;
      continue;
    }

    const title = pickTitleFromResultBlock(block);
    if (!title) {
      pos = i + 20;
      continue;
    }

    seen.add(asin);
    rank += 1;
    const product_url = `https://www.amazon.co.jp/dp/${asin}`;
    let isbn10_from_url: string | undefined;
    if (looksLikeIsbn10(asin)) {
      isbn10_from_url = asin;
    }
    hits.push({
      rank,
      asin,
      title,
      product_url,
      isbn10_from_url,
    });
    pos = i + 20;
  }

  return hits;
}

export async function fetchAmazonJpBooksSearchJson(
  keywords: string,
): Promise<Record<string, unknown>> {
  const q = keywords.trim();
  if (!q) {
    return { error: "empty_keywords", results: [] };
  }

  const search_url = buildSearchUrl(q);

  try {
    const res = await fetch(search_url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!res.ok) {
      return {
        error: `http_${res.status}`,
        search_url,
        results: [],
      };
    }

    const html = await res.text();
    const results = parseSearchResultsHtml(html, 12);

    if (results.length === 0 && html.length < 50_000) {
      if (html.includes("validateCaptcha") || html.includes("Captcha")) {
        return {
          error: "amazon_captcha_or_bot_wall",
          search_url,
          results: [],
          hint: "検索ページを自動取得できませんでした。ブラウザで search_url を開いて確認してください。",
        };
      }
    }

    return {
      source: "amazon_co_jp_html_search",
      search_url,
      query: q,
      results,
      note:
        results.length === 0
          ? "ヒットをHTMLから抽出できませんでした（レイアウト変更またはブロックの可能性）。"
          : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: msg,
      search_url,
      results: [],
    };
  }
}
