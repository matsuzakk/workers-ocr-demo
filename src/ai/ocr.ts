import type { AiTextGenerationToolInputWithFunction } from "@cloudflare/ai-utils";
import { runWithTools } from "@cloudflare/ai-utils";
import type { Env } from "../env";
import { searchAmazonJpBooksViaWebSearch } from "./books-search/amazon";

const KIMI_MODEL = "@cf/moonshotai/kimi-k2.5" as const;

const OCR_PROMPT = `次の本の表紙・裏表紙・背表紙の画像から、読み取れるテキストを日本語の読み取り順で抽出してください。ISBN・タイトル・著者名が分かる場合は次の行形式で出してください。不明な行は出さないでください。

タイトル: （あれば）
著者: （あれば）
ISBN: （バーコードが読み取れた場合のみ。不明な場合は「不明」）
その他: （上記以外の重要な表記。不明な場合は「不明」）`;

function sniffImageMime(u8: Uint8Array, hint?: string | null): string {
  const h = hint?.split(";")[0]?.trim().toLowerCase();
  if (h && h.startsWith("image/")) return h;
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

function uint8ToBase64(u8: Uint8Array): string {
  const chunk = 0x8000;
  let bin = "";
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      u8.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

/**
 * モデルや API のバージョンによって戻り値が異なるため、
 * この関数ではモデルの戻り値を文字列に変換して返します。
 */
const stringifyModelOutput = (res: unknown): string => {
  // モデルの戻り値が文字列の場合はそれを返します。
  if (typeof res === "string") {
    return res.trim();
  }

  if (res && typeof res === "object") {
    const o = res as Record<string, unknown>;
    // モデルの戻り値が response というキーで文字列がある場合はそれを返します。
    if (typeof o.response === "string") {
      return o.response.trim();
    }

    // モデルの戻り値が response というキーでオブジェクトがあり、そのオブジェクトに output または text というキーで文字列がある場合はそれを返します。
    if (o.response && typeof o.response === "object") {
      const r2 = o.response as { output?: string; text?: string };
      if (r2.output && typeof r2.output === "string") return r2.output.trim();
      if (r2.text && typeof r2.text === "string") return r2.text.trim();
    }

    // モデルの戻り値が text というキーで文字列がある場合はそれを返します。
    if (typeof o.text === "string") {
      return o.text.trim();
    }

    // モデルの戻り値が choices というキーで配列があり、その配列の0番目の要素に text または message というキーで文字列がある場合はそれを返します。
    if (Array.isArray(o.choices) && o.choices[0]) {
      const c0 = o.choices[0] as {
        text?: string;
        message?: { content?: string };
      };
      if (c0.text) return c0.text.trim();
      if (c0.message?.content) return String(c0.message.content).trim();
    }
  }

  // モデルの戻り値が null でない場合はそれを文字列に変換して返します。
  if (res != null) {
    return String(res).trim();
  }

  return "";
};

/**
 * 画像 bytes を渡し、Workers AI（Kimi K2.5）によるテキスト抽出（OCR 相当）を行います。
 */
export const runOcr = async (
  env: { AI: Ai },
  bytes: ArrayBuffer,
  contentTypeHint?: string | null,
): Promise<string> => {
  const u8 = new Uint8Array(bytes);
  if (u8.length === 0) {
    throw new Error("画像データが空です");
  }
  if (u8.length > 6 * 1024 * 1024) {
    throw new Error("画像が大きすぎます（6MB 以下にしてください）");
  }

  const result = await env.AI.run(KIMI_MODEL, {
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: OCR_PROMPT },
          {
            type: "image_url" as const,
            image_url: {
              url: `data:${sniffImageMime(u8, contentTypeHint)};base64,${uint8ToBase64(u8)}`,
            },
          },
        ],
      },
    ],
  });

  return stringifyModelOutput(result);
};

const LLAMA_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;

const ENRICH_SYSTEM = `あなたは書誌データの編集者です。ユーザーから渡される「OCRで読み取った下書き」を基に、必ず search_amazon_jp_web を1回以上呼び出してください。

ツールは Google の検索 API で amazon.co.jp に限定した結果（results の title・link・snippet・isbn10_from_url）を返します。OCRのタイトル・著者に最も近い候補を選び、必要なら keywords を変えて再検索してもよい。

最終回答はツールで得た事実を優先し、次の行形式のみで書くこと。ISBNはツールの isbn10_from_url または OCR で読み取れたもののみ。根拠がなければ「不明」。捏造しない。

タイトル: （候補とOCRを突き合わせた表記）
著者: （分かる範囲）
ISBN: （上記ルールに従う）
その他: （スニペットやOCRから補える重要表記のみ）
Amazon JP（URL）: （選んだ1件の link をそのまま。なければ「不明」）`;

/**
 * OCR 下書きを @cloudflare/ai-utils の embedded function calling で
 * Web 検索（amazon.co.jp 限定・JSON API）に基づき整形します。
 */
export const enrichOcrDraftWithCatalogTools = async (
  env: Pick<Env, "AI" | "GOOGLE_CSE_API_KEY" | "GOOGLE_CSE_CX">,
  ocrDraft: string,
): Promise<string> => {
  const draft = ocrDraft.trim();
  if (!draft) {
    return ocrDraft;
  }

  const searchAmazonJpWebTool: AiTextGenerationToolInputWithFunction = {
    name: "search_amazon_jp_web",
    description:
      "amazon.co.jp 向けの Web 検索（JSON）。OCRから推測した書名・著者名などを短いキーワードにして keywords に渡す。",
    parameters: {
      type: "object",
      properties: {
        keywords: {
          type: "string",
          description:
            "検索キーワード（タイトル断片、著者名など。ツール側で amazon 付与とドメイン限定を行う）。",
        },
      },
      required: ["keywords"],
    },
    function: async (args: { keywords?: unknown }) => {
      const keywords = typeof args?.keywords === "string" ? args.keywords : "";
      const payload = await searchAmazonJpBooksViaWebSearch(env, keywords);
      return JSON.stringify(payload);
    },
  };

  const ai = env.AI as unknown as Parameters<typeof runWithTools>[0];
  const model = LLAMA_MODEL as unknown as Parameters<typeof runWithTools>[1];

  const out = await runWithTools(
    ai,
    model,
    {
      messages: [
        { role: "system", content: ENRICH_SYSTEM },
        {
          role: "user",
          content: `次の OCR 下書きを整えてください:\n\n${draft}`,
        },
      ],
      tools: [searchAmazonJpWebTool],
    },
    {
      maxRecursiveToolRuns: 2,
      strictValidation: false,
      verbose: false,
    },
  );

  return stringifyModelOutput(out as unknown);
};
