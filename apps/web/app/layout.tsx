import type { Metadata } from "next";
import Providers from "@/components/Providers";
import SignOutButton from "@/components/SignOutButton";
import ThemeToggle from "@/components/ThemeToggle";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "FeatureMania",
  description: "Multi-repo Kanban board scored by actual work being done",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <Providers>
          <header className="app-header">
            <div className="app-header-actions">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
