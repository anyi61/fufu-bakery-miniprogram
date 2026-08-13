import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "麦屿面包｜银豹路线 × 有赞路线 Demo",
  description: "同一批面包商品，两种微信小程序经营路线的可点击高保真 Demo。",
  metadataBase: new URL("https://maiyu-bakery-demo.openai.site"),
  openGraph: {
    title: "麦屿面包｜双路线微信点单 Demo",
    description: "银豹式效率点单 × 有赞式品牌经营，同一套商品直接比较。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "麦屿面包双路线微信点单 Demo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "麦屿面包｜双路线微信点单 Demo",
    description: "银豹式效率点单 × 有赞式品牌经营，同一套商品直接比较。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
