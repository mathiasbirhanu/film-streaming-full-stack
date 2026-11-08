import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "StreamRoots — stories from home",
  description:
    "Regional & diaspora VOD: pay-per-view and membership streaming with producer revenue share, per-user watermarked playback and admin-moderated publishing.",
  keywords: ["streaming", "VOD", "diaspora cinema", "pay per view", "membership", "Ethiopian movies", "telebirr"],
  openGraph: {
    title: "StreamRoots — stories from home",
    description:
      "Regional & diaspora VOD: pay-per-view and membership streaming with producer revenue share and per-user watermarked playback.",
    url: SITE_URL,
    siteName: "StreamRoots",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StreamRoots — stories from home",
    description:
      "Regional & diaspora VOD: pay-per-view and membership streaming with producer revenue share and per-user watermarked playback.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
