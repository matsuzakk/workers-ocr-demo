import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OCR デモ",
  description: "画像アップロードとジョブ確認",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-white antialiased">{children}</body>
    </html>
  );
}
