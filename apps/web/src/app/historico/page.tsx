import type { Metadata } from "next";
import { Suspense } from "react";
import { HistoryPage } from "@/components/history/history-page";

// The archive as a page of its own (TASK-history-share-image.md §2.1): link-preview
// crawlers read the HTML without running JS, so only a separate file can carry its own
// tags and image (opengraph-image.tsx next to this file). `?historico` on index.html still
// works for links already shared.
const TITLE = "Eleições anteriores · Apuração 2026";
const DESCRIPTION =
  "As oito eleições para presidente de 1994 a 2022, município por município, com os arquivos do TSE: como a sua cidade votou, quem decidiu e o que mudou.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/historico.html" },
  openGraph: { type: "website", locale: "pt_BR", siteName: "Apuração 2026", title: TITLE, description: DESCRIPTION, url: "/historico.html" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function Historico() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-panel px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      {/* The answers read the query string (?ano, ?mun), so they sit under a Suspense boundary. */}
      <Suspense>
        <HistoryPage />
      </Suspense>
    </>
  );
}
