import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "URL to Markdown · webcrawl",
  description: "Read a public URL as clean Markdown using the webcrawl hosted API or local CLI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
