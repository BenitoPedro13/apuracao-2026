import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The link preview (TASK-share-metadata.md §2.1): an urna waiting for a vote. No counts and
// no candidates: previews are cached for days, so a number here would be shared stale.
// Generated once at build time (no request-time API), so it works with the static export.

export const alt = "Apuração 2026: a tela da urna com duas casas vazias e as teclas Branco, Corrige e Confirma.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// The export needs it said: generated once, at build time.
export const dynamic = "force-static";

// The light theme's tokens (globals.css); the keys are the urna's own colours.
const PAPER = "#f4f6f7";
const PANEL = "#ffffff";
const WASH = "#eef1f3";
const LINE = "#d9dfe3";
const INK = "#11171a";
const INK_2 = "#56636b";
const CONFIRMA = "#1b7f4b";
const CORRIGE = "#e07a1f";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function OpengraphImage() {
  const [regular, bold, mono] = await Promise.all([
    font("AtkinsonHyperlegibleNext-Regular.ttf"),
    font("AtkinsonHyperlegibleNext-Bold.ttf"),
    font("AtkinsonHyperlegibleMono-SemiBold.ttf"),
  ]);

  const key = (label: string, bg: string, fg: string, border = bg) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 132,
        height: 58,
        borderRadius: 10,
        background: bg,
        color: fg,
        border: `3px solid ${border}`,
        boxShadow: "inset 0 -5px 0 rgba(0,0,0,0.18)",
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: 1,
      }}
    >
      {label}
    </div>
  );
  const digit = (
    <div style={{ display: "flex", width: 92, height: 116, border: `5px solid ${INK}`, borderRadius: 6, background: PANEL }} />
  );

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: PAPER, color: INK, fontFamily: "Atkinson" }}>
        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 56, padding: "56px 64px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
            <div style={{ display: "flex", fontSize: 26, color: INK_2 }}>Eleições gerais · Brasil</div>
            <div style={{ display: "flex", fontSize: 100, fontWeight: 700, lineHeight: 1, letterSpacing: -2 }}>Apuração 2026</div>
            <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: INK_2 }}>
              Presidente, governadores, Senado e Câmara, com os arquivos publicados pelo TSE.
            </div>
          </div>

          {/* The urna: its screen asking for a number, then its three coloured keys. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              padding: 28,
              borderRadius: 24,
              background: PANEL,
              border: `2px solid ${LINE}`,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "22px 28px 28px", borderRadius: 12, background: WASH }}>
              <div style={{ display: "flex", fontSize: 18, color: INK_2, letterSpacing: 1 }}>SEU VOTO PARA</div>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>Presidente</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}>
                <div style={{ display: "flex", fontSize: 24 }}>Número:</div>
                {digit}
                {digit}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {key("BRANCO", PANEL, INK, LINE)}
              {key("CORRIGE", CORRIGE, INK)}
              {key("CONFIRMA", CONFIRMA, PANEL)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "0 64px",
            padding: "26px 0 34px",
            borderTop: `2px solid ${LINE}`,
            fontFamily: "Atkinson Mono",
            fontSize: 26,
          }}
        >
          <div style={{ display: "flex" }}>2º turno · domingo, 25/10/2026</div>
          <div style={{ display: "flex", color: INK_2 }}>sem projeção</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Atkinson", data: regular, weight: 400, style: "normal" },
        { name: "Atkinson", data: bold, weight: 700, style: "normal" },
        { name: "Atkinson Mono", data: mono, weight: 600, style: "normal" },
      ],
    },
  );
}
