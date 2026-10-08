// Canonical JSON: object keys sorted by code unit, no whitespace, no undefined, finite
// numbers only. The same value always serializes to the same bytes, which is what makes
// content-addressed views and the replay test work (architecture.md §5.3).
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`non-finite number in a view: ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys
        .map((k) => {
          if (obj[k] === undefined) throw new Error(`undefined at key ${k}`);
          return `${JSON.stringify(k)}:${canonicalJson(obj[k])}`;
        })
        .join(',')}}`;
    }
    default:
      throw new Error(`cannot serialize ${typeof value} in a view`);
  }
}
