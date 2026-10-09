"use client";

import { X } from "lucide-react";
import { Calc } from "@/components/num";
import { useHover, type HoverStore } from "@/hooks/use-map-renderer";
import type { MapModel, MunicipalityInfo } from "@/hooks/use-map";
import { formatBp } from "@/lib/format";
import { partyColor } from "@/lib/party";
import { Swatch } from "./map-legend";

const WIDTH_PX = 248;
const OFFSET_PX = 14;

/** The hovered (or tapped) municipality's card, kept inside the map's box. */
export function MapTooltip({
  store,
  model,
  size,
  onClose,
}: {
  store: HoverStore;
  model: MapModel;
  /** The map box's CSS size; the store's x/y are relative to it. */
  size: { width: number; height: number };
  onClose: () => void;
}) {
  const hover = useHover(store);
  if (hover.i === null) return null;
  const info = model.describe(hover.i);
  const { x, y } = hover;
  const flip = x + OFFSET_PX + WIDTH_PX > size.width;
  const left = Math.max(4, Math.min(size.width - WIDTH_PX - 4, flip ? x - WIDTH_PX - OFFSET_PX : x + OFFSET_PX));
  const top = Math.max(4, Math.min(size.height - 140, y + OFFSET_PX));

  return (
    <div
      role={hover.pinned ? "dialog" : "tooltip"}
      aria-label={hover.pinned ? info.name : undefined}
      className="absolute z-20 flex flex-col gap-1.5 rounded-md border border-line bg-panel p-3 text-sm shadow-lg"
      // A tapped municipality's card sits along the bottom of the map (a sheet), since the
      // map zooms away from where the finger was.
      style={hover.pinned ? { left: 8, right: 8, bottom: 8, maxWidth: 360 } : { left, top, width: WIDTH_PX, pointerEvents: "none" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="leading-tight font-semibold">
          {info.name} <span className="font-normal text-ink-2">· {info.uf.toUpperCase()}</span>
        </p>
        {hover.pinned && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-m-1 rounded-sm p-1 text-ink-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <MunicipalityLines info={info} token={model.style.tokenOf[info.i]!} failed={model.style.failed.includes(info.i)} />
    </div>
  );
}

function MunicipalityLines({ info, token, failed }: { info: MunicipalityInfo; token: Parameters<typeof Swatch>[0]["token"]; failed: boolean }) {
  const counted =
    info.countedBp === null ? null : (
      <p className="text-ink-2">
        <span className="font-mono">{formatBp(info.countedBp)}%</span> das seções apuradas
      </p>
    );
  if (info.status === "not_published") return <p className="text-ink-2">Aguardando dados do TSE</p>;
  if (info.status === "no_sections") return <p className="text-ink-2">Nenhuma seção apurada</p>;
  return (
    <>
      {info.leader ? (
        <p className="flex items-center gap-2">
          <Swatch token={token} failed={failed} />
          <span>
            <span className="font-medium">{info.leader.name}</span>{" "}
            <span className="text-xs font-medium" style={{ color: partyColor(info.leader.party) }}>
              {info.leader.party}
            </span>{" "}
            lidera
          </span>
        </p>
      ) : info.tie ? (
        <p className="flex items-center gap-2">
          <Swatch token="tie" />
          Empate exato entre os dois mais votados
        </p>
      ) : (
        <p className="text-ink-2">Nenhum voto apurado</p>
      )}
      {info.leader && info.marginBp !== null && (
        <p>
          Vantagem de{" "}
          <Calc how="Votos do primeiro menos os do segundo, sobre os votos válidos do município (arquivo do TSE).">
            {formatBp(info.marginBp)} pontos
          </Calc>
        </p>
      )}
      {counted}
      {failed && <p className="text-xs font-medium text-warn">Falha ao atualizar: último resultado recebido</p>}
    </>
  );
}
