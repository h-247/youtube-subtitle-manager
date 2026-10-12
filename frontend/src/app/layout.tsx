import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../lib/auth";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "YouTube Subtitle Manager",
  description: "Local-first subtitle manager with yt-dlp and Google Drive integration",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#212121] text-[#ececec] antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
