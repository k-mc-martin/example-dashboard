import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SecDash",
  description: "An interactive security dashboard with demo accounts and fictional business activity.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
