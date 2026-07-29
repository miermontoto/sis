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

export interface MergeSuggestion {
  id: string;
  name: string;
  image_url: string | null;
  plays: number;
}

export interface AlbumMergeTrack {
  id: string;
  name: string;
  trackNumber: number | null;
  discNumber: number | null;
  durationMs: number;
}

export interface AlbumMergeMatch {
  sourceTrackId: string;
  targetTrackId: string;
  confidence: 'position' | 'name';
}

export interface AlbumMergePreview {
  source: { id: string; name: string; imageUrl: string | null; tracks: AlbumMergeTrack[] };
  target: { id: string; name: string; imageUrl: string | null; tracks: AlbumMergeTrack[] };
  matches: AlbumMergeMatch[];
}

export interface AlbumMergeResult {
  albumRule: { id: number; sourceId: string; targetId: string };
  trackRules: Array<{ id: number; sourceTrackId: string; targetTrackId: string }>;
  skipped: string[];
}

// 'duplicate' = mismo tema con distinto ID/nombre dentro del grupo de álbumes
// (típicamente shells colapsados: "Walk On Water" ←→ "Walk On Water (feat. Beyoncé)")
export type RemergeConfidence = 'position' | 'name' | 'duplicate';

export interface RemergePreviewPair {
  sourceTrack: AlbumMergeTrack;
  targetTrack: AlbumMergeTrack;
  sourceAlbumName: string;
  confidence: RemergeConfidence;
}

export interface RemergePreview {
  pairs: RemergePreviewPair[];
  sourceAlbums: Array<{ id: string; name: string }>;
}

// barrido masivo: candidatos de varios álbumes del top, agrupados por álbum
export interface BulkRemergeAlbum {
  id: string;
  name: string;
  imageUrl: string | null;
  playCount: number;
  pairs: RemergePreviewPair[];
}

export interface BulkRemergePreview {
  scope: string;
  scanned: number;
  albums: BulkRemergeAlbum[];
  totalPairs: number;
}

// impacto de unos merges propuestos sobre el ranking all-time
export interface MergeImpactItem {
  id: string;
  // null = fuera del ranking (sin reproducciones)
  rankBefore: number | null;
  rankAfter: number | null;
  valueBefore: number;
  valueAfter: number;
}

export interface MergeImpact {
  entityType: string;
  metric: 'time' | 'plays';
  // umbral de "entra en el top N"
  topThreshold: number;
  items: MergeImpactItem[];
  movedCount: number;
  enteredTop: number;
  biggest: MergeImpactItem[];
}

export interface MakeCanonicalResult {
  entityType: string;
  canonicalId: string;
  previousCanonicalId: string;
  // reglas reescritas en el grupo (el canónico viejo + los hermanos repuntados)
  rulesRewritten: number;
  // grupos de tracks arrastrados al promover un álbum
  nestedTrackGroups: number;
}

export interface BatchMergeResult {
  created: number;
  skipped: string[];
}
