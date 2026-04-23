// Small deep-merge helper for plain JSON objects — used by the user-settings
// route ([B11]) to merge stored `settingsJson` with incoming PATCH payloads
// and with built-in defaults. Arrays are replaced wholesale (not concatenated);
// non-plain values (null, primitives) replace the target value.
//
// Intentionally narrow in scope: there's no handling of Maps, Sets, Dates,
// class instances, or cyclic references because none of those appear in
// settingsJson. Do not reuse this outside of JSON-shaped config merging
// without auditing those edge cases first.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = { ...target };
  for (const [key, sourceVal] of Object.entries(source)) {
    const targetVal = out[key];
    if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
      out[key] = deepMerge(targetVal, sourceVal);
    } else {
      out[key] = sourceVal;
    }
  }
  return out as T;
}
