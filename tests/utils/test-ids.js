const counters = new Map();

export function nextTestId(level) {
  // Build a short, file-scoped prefix from the caller's path so IDs are unique
  // across test files even under the forks pool.
  const stack = new Error().stack || '';
  const callerLine = stack
    .split('\n')
    .slice(2)
    .find((line) => line.includes('/tests/') && !line.includes('/test-ids.js'));
  const match = callerLine?.match(/\/(tests\/(?:api|e2e)\/[^:/\s]+\.test\.js)/);
  const scope = match?.[1]
    .replace(/^tests\/(api|e2e)\//, '$1-')
    .replace(/\.test\.js$/, '')
    .replaceAll('/', '-') ?? 'unknown';
  const key = `${scope}::${level}`;
  const next = (counters.get(key) || 0) + 1;
  counters.set(key, next);
  return `5.5-${scope}-${level}-${String(next).padStart(3, '0')}`;
}
