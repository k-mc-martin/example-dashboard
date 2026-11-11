import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Dupdash Example Dashboard",
  description: "Example workspace for communications, sales, releases and operations.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
