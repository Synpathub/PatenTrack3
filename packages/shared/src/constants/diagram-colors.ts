/**
 * Conveyance type color mapping (BR-031)
 * Used by D3 ownership diagram in both dashboard and share viewer
 */
export const CONVEYANCE_COLORS: Record<string, string> = {
  assignment: '#E53E3E',  // red
  namechg: '#3182CE',     // blue
  security: '#DD6B20',    // orange
  release: '#38A169',     // green
  license: '#D69E2E',     // yellow
  employee: '#805AD5',    // purple
  merger: '#D53F8C',      // pink
  govern: '#718096',      // gray
  correct: '#4FD1C5',     // teal
  missing: '#A0AEC0',     // light gray
} as const;

export type ConveyanceType = keyof typeof CONVEYANCE_COLORS;
