import { ABROAD, UFS } from "@apuracao/tse/codes";

// Names of the 27 UFs (IBGE) and abroad, for labels only; codes come from @apuracao/tse.

export const UF_NAMES: Record<string, string> = {
  ac: "Acre", al: "Alagoas", am: "Amazonas", ap: "Amapá", ba: "Bahia", ce: "Ceará",
  df: "Distrito Federal", es: "Espírito Santo", go: "Goiás", ma: "Maranhão", mg: "Minas Gerais",
  ms: "Mato Grosso do Sul", mt: "Mato Grosso", pa: "Pará", pb: "Paraíba", pe: "Pernambuco",
  pi: "Piauí", pr: "Paraná", rj: "Rio de Janeiro", rn: "Rio Grande do Norte", ro: "Rondônia",
  rr: "Roraima", rs: "Rio Grande do Sul", sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo",
  to: "Tocantins", [ABROAD]: "Exterior",
};

/** The 27 UFs in name order, then abroad. */
export const AREAS: readonly string[] = [...[...UFS].sort((a, b) => UF_NAMES[a]!.localeCompare(UF_NAMES[b]!, "pt-BR")), ABROAD];

export const areaName = (area: string) => UF_NAMES[area] ?? area.toUpperCase();
