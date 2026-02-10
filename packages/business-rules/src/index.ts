export { classifyConveyance, classifyBatch, isOwnershipTransfer, isEncumbrance, isRelease } from './classify';
export type { ClassificationResult } from './classify';

export { normalizeName, levenshteinDistance, groupEntities } from './normalize';
export type { EntityCandidate, EntityGroup } from './normalize';

export { generateNameVariations, matchInventorToAssignor, matchInventorsToAssignment } from './inventor-match';
export type { InventorName, InventorMatchResult } from './inventor-match';

export { analyzeChain } from './broken-chain';
export type { ChainTransaction, ChainBreak, ChainAnalysis } from './broken-chain';
