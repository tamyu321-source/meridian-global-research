import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "meridian-global-signals.yorkehsu.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  const title = "Meridian — Auditable Global Investment Research";
  const description = "Private seven-market stock and ETF research with auditable shadow signals, risk plans, paper trading and data-health controls.";
  return {
    title, description,
    openGraph: { title, description, type: "website", url: baseUrl, images: [{ url: `${baseUrl}/og.png`, width: 1731, height: 909, alt: "Meridian global investment research" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${baseUrl}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
