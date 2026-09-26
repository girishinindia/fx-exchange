import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FX Desk", template: "%s · FX Desk" },
  description: "Currency Exchange Management — private portal",
  robots: { index: false, follow: false }, // private portal: never indexed
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection(); // every page is rendered per request, so each gets its own CSP nonce (see proxy.ts)
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-slate-800">{children}</body>
    </html>
  );
}
