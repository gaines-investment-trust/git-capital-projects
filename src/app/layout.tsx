import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "./sw-register";

export const metadata: Metadata = {
  title: "GIT Capital Projects",
  description: "Gaines Investment Trust capital projects platform",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "GIT Projects", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#1B3358", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<ServiceWorker /></body>
    </html>
  );
}
