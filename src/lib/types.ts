export type EntityType = 'person' | 'project' | 'org' | 'concept' | 'place' | 'tool';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'urgent';

export interface Entity {
  name: string;
  type: EntityType;
}

/** What Gemini pulls out of a raw voice note. */
export interface Extraction {
  title: string;
  summary: string;
  sentiment: Sentiment;
  tags: string[];
  actionItems: string[];
  entities: Entity[];
}

/** A note as stored in Qdrant (payload) plus its id. */
export interface Note extends Extraction {
  id: string;
  text: string;
  createdAt: string;
  source: 'voice' | 'text';
  /** Action item strings the user has ticked off. */
  completedActions?: string[];
}

export type NodeKind = 'note' | 'entity';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** entity type for entity nodes, sentiment for note nodes */
  variant: string;
  /** how many edges touch this node — drives render size */
  degree: number;
  createdAt?: string;
  summary?: string;
}

export type EdgeKind = 'mentions' | 'similar';

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  /** 0..1 — similarity score, or 1 for hard entity links */
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    notes: number;
    entities: number;
    connections: number;
    density: number;
  };
}

export interface Citation {
  id: string;
  title: string;
  score: number;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
}
