import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Operations Dashboard Demo",
  description: "Explore how a business controls access, approves refunds, deploys changes, and recovers from failures.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
