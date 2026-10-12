import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "תקציב הבית",
  description: "ניהול הוצאות, תקציב וחיסכון של הבית",
  appleWebApp: { capable: true, title: "תקציב הבית" },
  // iOS takes the home screen icon from this link rather than from the manifest.
  icons: { apple: "/pwa-icon/192" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4f2" },
    { media: "(prefers-color-scheme: dark)", color: "#17162a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
