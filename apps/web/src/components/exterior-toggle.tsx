"use client";

import { Globe } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { useShowExterior } from "@/hooks/use-url-state";

/** Shows or hides abroad in the tables (and, later, the map). */
export function ExteriorToggle() {
  const [show, setShow] = useShowExterior();
  return (
    <Toggle variant="outline" size="sm" pressed={show} onPressedChange={setShow} aria-label="Incluir o exterior">
      <Globe aria-hidden />
      Exterior
    </Toggle>
  );
}
