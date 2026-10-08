// The 5 IBGE macro-regions (https://www.ibge.gov.br/geociencias/organizacao-do-territorio/divisao-regional/15778-divisoes-regionais-do-brasil.html).
export const REGIONS = [
  { code: 'N', name: 'Norte', ufs: ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to'] },
  { code: 'NE', name: 'Nordeste', ufs: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'] },
  { code: 'CO', name: 'Centro-Oeste', ufs: ['df', 'go', 'ms', 'mt'] },
  { code: 'SE', name: 'Sudeste', ufs: ['es', 'mg', 'rj', 'sp'] },
  { code: 'S', name: 'Sul', ufs: ['pr', 'rs', 'sc'] },
] as const;
