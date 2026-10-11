import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "תקציב הבית",
  description: "ניהול הוצאות, תקציב וחיסכון של הבית",
  appleWebApp: { capable: true, title: "תקציב הבית" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1513" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
