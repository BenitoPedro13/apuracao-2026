import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { preload } from "react-dom";
import { SITE_URL } from "@/data/config";
import { GEO_FILE } from "@/map/geo-file";
import { Providers } from "./providers";
import "./globals.css";

// Type: the Atkinson Hyperlegible family (TASK-visual-identity.md §2.2), drawn so 0/O,
// 1/l/I and 6/8 stay distinct for low-vision readers. Mono sets every TSE number.
const atkinson = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"], display: "swap" });
const atkinsonMono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"], display: "swap" });

// Share metadata (TASK-share-metadata.md §2.2). The image is opengraph-image.tsx; the
// canonical is /index.html because the bucket's REST endpoint doesn't serve "/".
const TITLE = "Apuração 2026";
const DESCRIPTION =
  "A apuração das eleições de 2026 ao vivo, com os arquivos publicados pelo TSE: presidente, governadores, Senado e Câmara, por estado e por município.";

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/index.html" },
  openGraph: { type: "website", locale: "pt_BR", siteName: TITLE, title: TITLE, description: DESCRIPTION, url: "/index.html" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1214" },
  ],
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
