/**
 * Shingle-based near-duplicate detection for article titles.
 *
 * The same news event reaches Kernelia from multiple sources (Ars Technica,
 * Wired, TechCrunch) with distinct canonical URLs, so the URL-hash dedupe
 * in `lib/ingest/dedupe.ts` doesn't catch them. This module compares
 * **content** instead: build word n-grams ("shingles") from each title,
 * intersect them via Jaccard similarity, flag the pair if similarity
 * crosses a threshold.
 *
 * Why shingles + Jaccard and not LLM embeddings:
 *   - Deterministic. Same titles → same verdict, run after run.
 *   - Zero token cost. The classify pipeline already burns Cerebras tokens;
 *     dedupe shouldn't add to that budget.
 *   - Fast. O(n) per comparison, O(N*M) total per cron tick — fine for
 *     the ~10 candidates × ~100 recent articles we actually compare.
 *   - Bilingual-friendly. We dedupe on `titleEs` (LLM-translated to ES),
 *     so we never need to mix EN/ES vocabularies.
 *
 * Falls short when the same event is summarised with very different
 * wording. That's an accepted trade-off: missing a duplicate degrades
 * to "the feed has redundancy" (the status quo); false-positives
 * degrade to "an article is hidden and the operator un-hides it from
 * /admin/articles" — recoverable.
 */

/**
 * Default similarity threshold above which two titles are treated as
 * near-duplicates. Empirical on the Musk/OpenAI cluster after stop-word
 * removal:
 *
 *   ars     ∩ wired      = {elon, musk, pierde, juicio, openai}      → J = 5/10 = 0.50
 *   ars     ∩ techcrunch = {elon, musk, pierde, openai}              → J = 4/12 = 0.33
 *   wired   ∩ techcrunch = {elon, musk, pierde, contra, openai}      → J = 5/10 = 0.50
 *
 * 0.4 catches the wired↔ars and wired↔techcrunch pairs and lets ars↔
 * techcrunch dedupe transitively (techcrunch will see wired in its
 * recent window and link to it). False-positive risk band stays around
 * 0.25–0.35 (incidental keyword overlap from boilerplate phrasing).
 */
export const DEFAULT_DEDUPE_THRESHOLD = 0.4;

/**
 * Default shingle window. **1-gram (bag of significant words) is the right
 * choice for news headlines in Spanish**: titles paraphrase aggressively
 * across publications ("pierde el juicio", "pierde un juicio histórico",
 * "pierde su demanda"), so 2- and 3-grams almost never overlap even when
 * the underlying event is identical. Bag-of-words on the normalised
 * tokens (after stop-word removal) captures the topical entities
 * (Elon Musk, OpenAI, juicio) which IS what tells us the event is the
 * same. Order is sacrificed; for headlines that trade-off is fine.
 */
export const DEFAULT_SHINGLE_N = 1;

/**
 * Spanish + English stop words. Stripped from titles before shingling so
 * "Elon Musk pierde el juicio" and "Elon Musk pierde un juicio" produce
 * the same content tokens. Kept small on purpose — over-aggressive
 * stop-word lists strip topical words ("AI", "system") that matter.
 */
const STOP_WORDS = new Set<string>([
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "en", "y", "o", "u", "a", "al",
  "que", "se", "su", "sus", "es", "son", "ser",
  "por", "para", "con", "sin", "sobre", "ante", "tras",
  // English
  "the", "a", "an", "of", "in", "on", "to", "for", "with",
  "and", "or", "is", "are", "by", "at", "as", "from",
  "this", "that", "it", "its",
]);

/**
 * Normalises a string for shingling: NFD-decompose accents, strip them,
 * lowercase, drop punctuation, collapse whitespace, drop stop words.
 *
 * Output is a deterministic token array — order matters when we later
 * window into n-grams.
 */
export function normalizeForShingle(input: string): string[] {
  return input
    .normalize("NFD")
    // Diacritics live as a separate combining-character block; strip them.
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    // Keep alphanumerics + whitespace. Everything else (punctuation,
    // dashes, quotes, emoji) becomes a separator.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !STOP_WORDS.has(tok));
}

/**
 * Produces all contiguous n-grams of `tokens` as space-joined strings.
 *
 * For short titles (fewer tokens than `n`), falls back to lower-order
 * grams so we never return an empty Set. That keeps the Jaccard math
 * defined (we don't divide by zero on the union) and gives us a fair
 * comparison for headlines like "GPT-5 ships" (2 tokens after stop-word
 * removal).
 */
export function wordShingles(tokens: readonly string[], n: number = DEFAULT_SHINGLE_N): Set<string> {
  if (tokens.length === 0) return new Set();
  const effectiveN = Math.min(n, tokens.length);
  const out = new Set<string>();
  for (let i = 0; i <= tokens.length - effectiveN; i++) {
    out.add(tokens.slice(i, i + effectiveN).join(" "));
  }
  return out;
}

/**
 * Jaccard similarity between two Sets: |A ∩ B| / |A ∪ B|.
 *
 * Returns 0 if both sets are empty (no information to compare on).
 * Result is always in [0, 1].
 */
export function jaccardSimilarity<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  // Iterate the smaller set for marginal speed.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DedupeCandidate {
  id: string;
  /** Title used to build the shingle set. Already in ES for parity across sources. */
  title: string;
}

export interface DedupeMatch {
  /** ID of the existing recent article that the candidate duplicates. */
  matchedId: string;
  /** Computed Jaccard similarity. */
  similarity: number;
}

/**
 * Finds the highest-similarity recent article that `candidate` duplicates,
 * or `null` if nothing crosses the threshold.
 *
 * The caller is responsible for the recent-article window (e.g. last 48h)
 * and for feeding in titles in the same language as the candidate.
 *
 * Cost: O(|recents|) shingle-set builds + Jaccards. For the typical
 * cron-tick load (10 new × 100 recents) that's 100 cheap Set operations
 * per article = ~negligible compared to the LLM call that ran just
 * before.
 */
export function findNearDuplicate(
  candidate: DedupeCandidate,
  recents: readonly DedupeCandidate[],
  opts: { threshold?: number; n?: number } = {},
): DedupeMatch | null {
  const threshold = opts.threshold ?? DEFAULT_DEDUPE_THRESHOLD;
  const n = opts.n ?? DEFAULT_SHINGLE_N;

  const candidateShingles = wordShingles(normalizeForShingle(candidate.title), n);
  if (candidateShingles.size === 0) return null;

  let best: DedupeMatch | null = null;
  for (const recent of recents) {
    if (recent.id === candidate.id) continue;
    const recentShingles = wordShingles(normalizeForShingle(recent.title), n);
    if (recentShingles.size === 0) continue;
    const similarity = jaccardSimilarity(candidateShingles, recentShingles);
    if (similarity >= threshold && (best === null || similarity > best.similarity)) {
      best = { matchedId: recent.id, similarity };
    }
  }
  return best;
}
