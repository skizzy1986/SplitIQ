import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';
import { invalidateSessionQueries } from '../utils/invalidateSessionQueries.js';

// Same shape as useVitalsSync: a thin mutation over an edge function, with the
// cache invalidation the write implies.
//
// Prefix invalidation reaches the shared recent and full-history readers.
// onSynced remains an optional notification for existing integration callers.
export function useStravaSync({ onSynced } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['strava', 'sync'],
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('strava-sync', {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['strava', 'connection'] });
      invalidateSessionQueries(queryClient);
      onSynced?.(data);
    },
  });
}
