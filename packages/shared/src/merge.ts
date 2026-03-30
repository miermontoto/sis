export interface MergeRule {
  id: number;
  entity_type: string;
  source_id: string;
  target_id: string;
  source_name: string;
  source_image: string | null;
  target_name: string;
  target_image: string | null;
  artist_id: string | null;
  artist_name: string | null;
  artist_image: string | null;
  created_at: string;
}

export interface MergeSuggestionAlbum {
  id: string;
  name: string;
  image_url: string | null;
  plays: number;
}
