import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "小雨面包｜预约自提小程序初版",
  description: "小雨面包银豹式高效点单初版，跑通顾客预约自提与门店接单、制作、核销闭环。",
  metadataBase: new URL("https://maiyu-bakery-demo.openai.site"),
  openGraph: {
    title: "小雨面包｜预约自提小程序初版",
    description: "顾客预约自提 × 门店接单生产核销，首发功能闭环 Demo。",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "小雨面包预约自提小程序初版" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "小雨面包｜预约自提小程序初版",
    description: "顾客预约自提 × 门店接单生产核销，首发功能闭环 Demo。",
    images: ["/og-v2.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
