import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Featuremania",
  description: "Multi-repo Kanban board scored by actual work being done",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
