import type { MetadataRoute } from "next";

// Makes the site installable on the phone's home screen (Chrome -> "Add to Home screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "תקציב הבית",
    short_name: "תקציב",
    description: "ניהול הוצאות, תקציב וחיסכון של הבית",
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "he",
    background_color: "#f5f4ef",
    theme_color: "#1f6f54",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
