import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "EdgeVault — Offline-First Edge Memory System",
  description: "Private by default, intelligent when connected. Built on Qdrant Edge.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased selection:bg-sky-500/30 selection:text-sky-200">
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
