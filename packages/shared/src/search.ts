export interface SearchResults {
  artists: { id: string; name: string; imageUrl: string | null; playCount: number }[];
  albums: { id: string; name: string; imageUrl: string | null; artistName: string | null; playCount: number }[];
  tracks: { id: string; name: string; albumImageUrl: string | null; artistName: string | null; playCount: number }[];
}
