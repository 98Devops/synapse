export type EntityType = 'person' | 'project' | 'org' | 'concept' | 'place' | 'tool';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'urgent';

/** What the speaker was *doing*. See docs/CLASSIFICATION.md. */
export type Intent =
  | 'task'
  | 'decision'
  | 'idea'
  | 'question'
  | 'observation'
  | 'reflection'
  | 'reference'
  | 'log'
  | 'unclassified';

export const INTENTS: Intent[] = [
  'task',
  'decision',
  'idea',
  'question',
  'observation',
  'reflection',
  'reference',
  'log',
  'unclassified',
];

export type NoteStatus = 'inbox' | 'needs_review' | 'filed' | 'archived';

/** Below this the note goes to review rather than being silently misfiled. */
export const CONFIDENCE_FLOOR = 0.6;

export interface Entity {
  name: string;
  type: EntityType;
}

export interface ActionFacet {
  text: string;
  owner?: string;
  dueDate?: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface DataPointFacet {
  label: string;
  value: string;
  unit?: string;
  kind: 'metric' | 'date' | 'money' | 'identifier' | 'fact';
}

export interface DecisionFacet {
  text: string;
  alternatives: string[];
}

/** What Gemini pulls out of a raw voice note. */
export interface Extraction {
  title: string;
  summary: string;
  sentiment: Sentiment;
  tags: string[];
  entities: Entity[];

  intent: Intent;
  intentConfidence: number;
  unclassifiedReason?: string;
  /** Free-text name of the area this belongs to; resolved to a Space server-side. */
  suggestedSpace?: string;

  actions: ActionFacet[];
  dataPoints: DataPointFacet[];
  questions: string[];
  decisions: DecisionFacet[];
}

/** A note as stored, in the shape the UI consumes. */
export interface Note extends Extraction {
  id: string;
  text: string;
  createdAt: string;
  source: 'voice' | 'text';
  status: NoteStatus;
  spaceId?: string | null;
  spaceName?: string | null;
  threadId?: string | null;
  audioPath?: string | null;
  /** Flat action text, kept because the graph and panels read it directly. */
  actionItems: string[];
  completedActions?: string[];
}

export interface Space {
  id: string;
  name: string;
  description: string;
  color: string;
  noteCount?: number;
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
