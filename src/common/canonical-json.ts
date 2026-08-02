/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every depth, so two structurally equal values always produce byte-identical
 * strings. This is the backbone of snapshot hashing and immutable replay — a
 * frozen result must serialize the same way forever, independent of the order
 * in which fields were built.
 */

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value) as JsonValue);
}
