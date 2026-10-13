import type { MetadataRoute } from "next";
import { SITE_URL } from "@/data/config";

// The live page (every office is a ?cargo= of it, TASK-share-metadata.md §2.2) and the
// archive's own page (TASK-history-share-image.md).
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/index.html`, changeFrequency: "always" },
    { url: `${SITE_URL}/historico.html`, changeFrequency: "yearly" },
  ];
}
