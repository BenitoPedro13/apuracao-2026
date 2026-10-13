import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The archive's link preview (TASK-history-share-image.md §2.2): the eight election years
// as a timeline. Years only: no counts, no candidates, no party colours (previews are cached
// for days and the image stays neutral, like the home's). Built once, for the static export.

export const alt = "Eleições anteriores: as oito eleições presidenciais de 1994 a 2022, município por município.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

// The light theme's tokens (globals.css), as in ../opengraph-image.tsx.
const PAPER = "#f4f6f7";
const PANEL = "#ffffff";
const WASH = "#eef1f3";
const LINE = "#d9dfe3";
const INK = "#11171a";
const INK_2 = "#56636b";

const YEARS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022];

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function OpengraphImage() {
  const [regular, bold, mono] = await Promise.all([
    font("AtkinsonHyperlegibleNext-Regular.ttf"),
    font("AtkinsonHyperlegibleNext-Bold.ttf"),
    font("AtkinsonHyperlegibleMono-SemiBold.ttf"),
  ]);

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: PAPER, color: INK, fontFamily: "Atkinson" }}>
        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 56, padding: "56px 64px 0" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
            <div style={{ display: "flex", fontSize: 26, color: INK_2 }}>Apuração 2026 · Presidente</div>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1, letterSpacing: -2 }}>Eleições anteriores</div>
            <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: INK_2 }}>
              Oito eleições, município por município, com os arquivos do TSE.
            </div>
          </div>

          {/* The eight elections, in order, two to a row. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              padding: 28,
              borderRadius: 24,
              background: PANEL,
              border: `2px solid ${LINE}`,
            }}
          >
            <div style={{ display: "flex", fontSize: 18, color: INK_2, letterSpacing: 1 }}>ELEIÇÕES PRESIDENCIAIS</div>
            <div style={{ display: "flex", flexWrap: "wrap", width: 296, gap: 12 }}>
              {YEARS.map((y) => (
                <div
                  key={y}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 142,
                    height: 66,
                    borderRadius: 10,
                    background: WASH,
                    border: `2px solid ${LINE}`,
                    fontFamily: "Atkinson Mono",
                    fontSize: 32,
                  }}
                >
                  {y}
                </div>
              ))}
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
          <div style={{ display: "flex" }}>1994–2022</div>
          <div style={{ display: "flex", color: INK_2 }}>arquivo do TSE</div>
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
