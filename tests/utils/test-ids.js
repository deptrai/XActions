let seq = 0;
export function nextTestId(level) {
  return `5.5-${level}-${String(++seq).padStart(3, '0')}`;
}
