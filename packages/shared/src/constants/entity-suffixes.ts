/**
 * International corporate entity suffix detection.
 * Used in name normalization to identify and standardize company suffixes.
 *
 * Source: update_flag.php, update_retirved_cited_patents_assignees.js
 * Business Rule: BR-017
 */
export const ENTITY_SUFFIX_REGEX =
  /\b(?:inc|llc|corporation|corp|systems|system|llp|industries|gmbh|lp|agent|sas|na|bank|co|states|ltd|kk|a\/s|aktiebolag|kigyo|kaisha|university|kabushiki|company|plc|gesellschaft|gesmbh|société|societe|mbh|aktiengesellschaft|haftung|vennootschap|bv|bvba|aktien|limitata|srl|sarl|kommanditgesellschaft|kg|gesellschaft|gbr|ohg|handelsgesellschaft|compagnie|privatstiftung|foundation|cie)\b/gi;

/**
 * Trailing suffix replacements applied in priority order.
 * First match wins — stop after first replacement.
 *
 * Source: normalize_file.php
 * Business Rules: BR-013 through BR-016
 */
export const SUFFIX_REPLACEMENTS: { trailing: string; replacement: string }[] = [
  { trailing: 'corporation', replacement: ' corp' },
  { trailing: 'incorporated', replacement: ' inc' },
  { trailing: 'limited', replacement: ' ltd' },
  { trailing: 'company', replacement: ' co' },
];

/**
 * Default Levenshtein distance threshold for name grouping.
 * Legacy used 3-5 inconsistently; we default to 5 and make configurable.
 *
 * Business Rule: BR-018
 */
export const DEFAULT_LEVENSHTEIN_THRESHOLD = 5;
