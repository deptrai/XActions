const counters = new Map();

export function nextTestId(scope, level, priority = 'P2') {
  // Build a short, file-scoped prefix from the caller-supplied scope so IDs are
  // unique across test files even under the forks pool, and append a priority
  // marker so the suite can be filtered by @P0–@P3.
  const key = `${scope}::${level}`;
  const next = (counters.get(key) || 0) + 1;
  counters.set(key, next);
  return `5.5-${scope}-${level}-${String(next).padStart(3, '0')} @${priority}`;
}
