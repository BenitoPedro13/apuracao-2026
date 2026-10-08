"use client";

import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShowExterior } from "@/hooks/use-url-state";

/** Shows or hides abroad in the tables (and, later, the map). A native toggle button. */
export function ExteriorToggle() {
  const [show, setShow] = useShowExterior();
  return (
    <Button variant={show ? "secondary" : "outline"} size="sm" aria-pressed={show} onClick={() => setShow(!show)}>
      <Globe aria-hidden />
      Exterior
    </Button>
  );
}
