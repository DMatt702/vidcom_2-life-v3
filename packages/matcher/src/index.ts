export interface MatchRequest {
  imageUrl: string;
}

export interface MatchResult {
  matched: boolean;
  confidence: number;
}