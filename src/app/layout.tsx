import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppProviders } from "@/components/console/providers";

export const metadata: Metadata = {
  title: "Headscale Easy Manager — کنسول مدیریت شبکهٔ خصوصی",
  description:
    "کنسول واقعی مدیریت Headscale: اتصال امن SSH به سرور شما، کاوش صادقانهٔ سیستم، مدیریت کاربران/دستگاه‌ها/کلیدها، نصب خودکار و ۱۴ فصل آموزش فارسی.",
  keywords: [
    "Headscale",
    "Tailscale",
    "WireGuard",
    "VPN",
    "hsctl",
    "شبکه خصوصی",
    "آموزش فارسی",
    "مدیریت سرور",
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
          <AppProviders>{children}</AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
