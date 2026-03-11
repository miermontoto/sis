// formatear duración en ms a minutos con separador de miles
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${formatNumber(minutes)} min`;
}

// formatear duración total en horas con decimal
export function formatHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// formatear número con separador de miles
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// formatear fecha relativa: "hace 5 min", "hace 2h", "ayer"
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// formatear fecha completa
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// nombres de días de la semana
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
