import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "단꿈 원가율 계산기",
  description: "음식점 메뉴 원가율 관리 도구 by 단꿈TV",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
