"use client";

import { useState } from "react";
import { Expand, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Share (Web Share API, else copy the link) and full screen. */
export function PageActions() {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
      } catch {
        // Dismissed by the user: nothing to do.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={share}>
        <Share2 aria-hidden />
        <span aria-live="polite">{copied ? "Link copiado" : "Compartilhar"}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={fullscreen}>
        <Expand aria-hidden />
        Tela cheia
      </Button>
    </div>
  );
}
