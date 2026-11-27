import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';
import { normalizeSettings, writablePatch } from '../utils/trainingSettings.js';

// Query and mutation keys carry no values: queryErrorHandlers.js sends them to
// Sentry, and these rows hold year of birth and a health flag (AC 42).
export const TRAINING_SETTINGS_KEY = ['trainingSettings'];
const UPDATE_KEY = ['trainingSettings', 'update'];

const COLUMNS =
  'hr_path, hr_path_chosen_on, birth_year, time_zone, base_block_started_on, screening_completed_on, hr_caution, depth';

// The table or a column is not in this project yet (027 is applied to dev
// first, production later). That is "defaults", not an error to report.
const ABSENT_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);

// One row per account, scoped by RLS, so there is no user_id filter. An absent
// row, table or column reads as defaults: nothing chosen, simple depth, and the
// caution flag off.
export function useTrainingSettings() {
  const query = useQuery({
    queryKey: TRAINING_SETTINGS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_training_settings')
        .select(COLUMNS)
        .maybeSingle();
      if (error) {
        if (ABSENT_CODES.has(error.code))
          return { available: false, row: null };
        throw error;
      }
      return { available: true, row: data ?? null };
    },
    staleTime: 60_000,
  });

  const result = query.data ?? { available: false, row: null };
  const settings = normalizeSettings(result.row);
  return {
    ...query,
    loaded: query.isSuccess,
    available: result.available,
    hasRow: result.row != null,
    settings,
    hrPath: settings.hr_path,
    birthYear: settings.birth_year,
    depth: settings.depth,
  };
}

// Writes only the columns the database allows. An upsert, so the first write
// creates the row (user_id comes from the column default, checked by RLS) and
// later writes update it. updated_at is set here because 027 has no trigger.
export function useUpdateTrainingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_KEY,
    mutationFn: async (patch) => {
      const values = {
        ...writablePatch(patch),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('user_training_settings')
        .upsert(values, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: TRAINING_SETTINGS_KEY }),
  });
}
