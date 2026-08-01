import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Continuity — Consistent AI video studio",
  description: "Build character-consistent, voice-consistent AI video sequences with durable provenance.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Continuity — One character. Every shot. Any model.",
    description: "A consistency-first AI video workflow powered by Genblaze and Backblaze B2.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Continuity AI video studio" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
