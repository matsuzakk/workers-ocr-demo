const OCR_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct" as const;

const OCR_PROMPT = `次の本の表紙・裏表紙・背表紙の画像から、読み取れるテキストを日本語の読み取り順で抽出してください。ISBN・タイトル・著者名が分かる場合は次の行形式で出してください。不明な行は出さないでください。

タイトル: （あれば）
著者: （あれば）
ISBN: （あれば）
その他: （上記以外の重要な表記）`;

/**
 * 画像 bytes を渡し、Workers AI によるテキスト抽出（OCR 相当）を行います。
 */
export async function runOcr(
  env: { AI: Ai },
  bytes: ArrayBuffer,
): Promise<string> {
  const u8 = new Uint8Array(bytes);
  if (u8.length === 0) {
    throw new Error("画像データが空です");
  }
  if (u8.length > 6 * 1024 * 1024) {
    throw new Error("画像が大きすぎます（6MB 以下にしてください）");
  }

  const result = (await env.AI.run(OCR_VISION_MODEL, {
    image: Array.from(u8),
    prompt: OCR_PROMPT,
  } as { image: number[]; prompt: string; max_tokens?: number })) as unknown;

  return pickTextFromModelOutput(result);
}

function pickTextFromModelOutput(r: unknown): string {
  if (typeof r === "string") {
    return r.trim();
  }
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (typeof o.response === "string") {
      return o.response.trim();
    }
    if (o.response && typeof o.response === "object") {
      const r2 = o.response as { output?: string; text?: string };
      if (typeof r2.output === "string") return r2.output.trim();
      if (typeof r2.text === "string") return r2.text.trim();
    }
    if (typeof o.text === "string") {
      return o.text.trim();
    }
    if (Array.isArray(o.choices) && o.choices[0]) {
      const c0 = o.choices[0] as {
        text?: string;
        message?: { content?: string };
      };
      if (c0.text) return c0.text.trim();
      if (c0.message?.content) return String(c0.message.content).trim();
    }
  }
  if (r != null) {
    return String(r).trim();
  }
  return "";
}
