import type { MetadataRoute } from "next";
import { SITE_URL } from "@/data/config";

// Static with the export (TASK-share-metadata.md §2.2).
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
