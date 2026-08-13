import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "小雨面包｜预约自提业务版",
  description: "小雨面包预约自提业务版，跑通真实库存、支付、门店接单、制作、备妥与核销闭环。",
  metadataBase: new URL("https://maiyu-bakery-demo.openai.site"),
  openGraph: {
    title: "小雨面包｜预约自提业务版",
    description: "顾客预约自提 × 门店接单生产核销，D1 实时业务闭环。",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "小雨面包预约自提业务版" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "小雨面包｜预约自提业务版",
    description: "顾客预约自提 × 门店接单生产核销，D1 实时业务闭环。",
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
