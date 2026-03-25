export function medalColor(rank: number): string | undefined {
  if (rank === 1) return 'var(--gold)';
  if (rank === 2) return 'var(--silver)';
  if (rank === 3) return 'var(--bronze)';
  return undefined;
}
