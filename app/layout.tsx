import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "小雨面包｜预约自提 Demo",
  description: "小雨面包预约自提交互 Demo，使用模拟库存、模拟支付和模拟商户数据。",
  metadataBase: new URL("https://maiyu-bakery-demo.openai.site"),
  openGraph: {
    title: "小雨面包｜预约自提 Demo",
    description: "顾客预约自提 × 门店接单生产核销交互演示。",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "小雨面包预约自提 Demo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "小雨面包｜预约自提 Demo",
    description: "顾客预约自提 × 门店接单生产核销交互演示。",
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
