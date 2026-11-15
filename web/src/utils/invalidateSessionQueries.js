// Every react-query query that reads `sessions`. A session insert must
// invalidate all of them; the three write paths each used to pick their own
// subset and disagreed (#195). ['sessions'] is a prefix, so it also reaches
// any ['sessions', …] sub-key — do not list those separately.
// The useSessionLog compatibility adapter reads the same owner-scoped cache.
export function invalidateSessionQueries(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['sessions'] });
  queryClient.invalidateQueries({ queryKey: ['erg-sessions'] });
  queryClient.invalidateQueries({ queryKey: ['tss-history'] });
}
