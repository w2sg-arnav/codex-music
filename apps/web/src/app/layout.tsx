import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";

const displayFont = Sora({
  variable: "--font-display",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Codex Music",
  description: "AI-native music editing studio for the web.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="site-shell min-h-full flex flex-col">{children}</body>
    </html>
  );
}
