/**
 * Task deduplication utility for OpenRalph.
 * Helps filter out semantically similar tasks during PRD generation.
 */

/**
 * Calculates Jaccard Similarity between two strings.
 * (Size of intersection / Size of union of word tokens)
 */
export function calculateSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.size / union.size;
}

/**
 * Clean and tokenize a string into words.
 */
function tokenize(text: string): string[] {
  // Common prefixes in plans that don't add semantic value for comparison
  const commonPrefixes = [
    "verify", "ensure", "check", "implement", "add", "create", "setup", "configure", 
    "make", "support", "test", "working", "functional", "enable", "disable", "works",
    "feature", "logic", "implementation", "integration", "configuration", "functionality"
  ];

  let cleaned = text.toLowerCase().replace(/[^\w\s]/g, "");
  
  const words = cleaned.split(/\s+/).filter(word => {
    // Allow short words if they are likely abbreviations (all caps in original)
    // but tokenize uses toLowerCase(), so we check original text? 
    // No, let's just allow common 2-letter tech terms or keep word length > 1
    const isTechTerm = /^(ui|ux|db|api|js|ts|io|id)$/i.test(word);
    return word.length > 2 || isTechTerm;
  });
  
  // Filter out the common task prefixes to compare the core "subject"
  return words.filter(word => !commonPrefixes.includes(word));
}

/**
 * Checks if a task is redundant compared to a list of existing tasks.
 * Uses a similarity threshold to decide.
 */
export function isRedundantTask(
  candidate: string,
  existingTasks: string[],
  threshold = 0.6
): boolean {
  // Check for exact matches first (fast)
  const normalizedCandidate = candidate.trim().toLowerCase();
  
  for (const existing of existingTasks) {
    const normalizedExisting = existing.trim().toLowerCase();
    
    // Exact match
    if (normalizedCandidate === normalizedExisting) return true;
    
    // Fuzzy match
    if (calculateSimilarity(normalizedCandidate, normalizedExisting) >= threshold) {
      return true;
    }
  }
  
  return false;
}
