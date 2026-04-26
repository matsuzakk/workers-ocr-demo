const OCR_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct" as const;

const OCR_PROMPT = `次の本の表紙・裏表紙・背表紙の画像から、読み取れるテキストを日本語の読み取り順で抽出してください。ISBN・タイトル・著者名が分かる場合は次の行形式で出してください。不明な行は出さないでください。

タイトル: （あれば）
著者: （あれば）
ISBN: （あれば）
その他: （上記以外の重要な表記）`;

/**
 * 画像 bytes を渡し、Workers AI によるテキスト抽出（OCR 相当）を行います。
 */
export const runOcr = async (
  env: { AI: Ai },
  bytes: ArrayBuffer,
): Promise<string> => {
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

  return stringifyModelOutput(result);
};

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
