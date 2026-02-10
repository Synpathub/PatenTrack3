// Re-export Zod-inferred types
export type { LoginRequest, RegisterRequest, UserResponse } from '../schemas/auth.js';
export type { CursorPagination, ApiError } from '../schemas/common.js';

// Additional types
export interface DiagramNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  parent: string | null;
  children: string[];
}

export interface DiagramLink {
  source: string;
  target: string;
  rfId: string;
  conveyanceType: string;
}

export interface DiagramData {
  nodes: DiagramNode[];
  links: DiagramLink[];
  rootId: string;
  patentNumber: string;
}
