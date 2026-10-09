import type { MetadataRoute } from "next";
import { SITE_URL } from "@/data/config";

// One page: every office is a ?cargo= of it (TASK-share-metadata.md §2.2).
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/index.html`, changeFrequency: "always" }];
}
