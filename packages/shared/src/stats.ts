export interface ListeningTimeItem {
  period: string;
  play_count: number;
  total_ms: number;
}

export interface HeatmapItem {
  day_of_week: number;
  hour: number;
  play_count: number;
}

export interface StreaksData {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
}

export interface GenreItem {
  genre: string;
  play_count: number;
}
