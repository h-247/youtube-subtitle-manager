import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  title: "YouTube Subtitle Manager",
  description: "Save, organize, search, and download YouTube subtitles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#212121] text-[#ececec] antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
