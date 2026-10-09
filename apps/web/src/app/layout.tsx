import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { preload } from "react-dom";
import { GEO_FILE } from "@/map/geo-file";
import { Providers } from "./providers";
import "./globals.css";

// Type: the Atkinson Hyperlegible family (TASK-visual-identity.md §2.2), drawn so 0/O,
// 1/l/I and 6/8 stay distinct for low-vision readers. Mono sets every TSE number.
const atkinson = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"], display: "swap" });
const atkinsonMono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Apuração 2026",
  description: "Apuração das eleições de 2026 com os dados publicados pelo TSE.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The map's geometry (~306 KB) starts downloading with the JS, not after the map's chunk.
  preload(`/${GEO_FILE.path}`, { as: "fetch", crossOrigin: "anonymous" });
  return (
    <html lang="pt-BR" className={`${atkinson.variable} ${atkinsonMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
