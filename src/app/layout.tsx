import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Headscale Easy Manager — خانه محصول و مرکز آموزش فارسی",
  description:
    "نصب‌کننده هوشمند، مدیر CLI و راهنمای جامع فارسی برای راه‌اندازی شبکه خصوصی مبتنی بر Headscale — ۱۴ فصل آموزش، ۱۷ گام نصب خودکار و مرجع کامل دستورات hsctl.",
  keywords: [
    "Headscale",
    "Tailscale",
    "WireGuard",
    "VPN",
    "hsctl",
    "شبکه خصوصی",
    "آموزش فارسی",
  ],
  authors: [{ name: "Headscale Easy Manager" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
