import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetDolff Companion",
  description:
    "Self-hosted bridge that lets your own AI agents read your MeetDolff meeting memory over authenticated, read-only MCP.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
