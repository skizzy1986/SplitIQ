import { useMutation } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';

// The body is an allow-list. The user id rides on the session JWT, which the
// function reads server-side. Email is never a field here.
function reportBody(report) {
  return {
    what: report.what,
    steps: report.steps ?? null,
    version: report.version,
    route: report.route,
    platform: report.platform,
  };
}

export function useReportProblem() {
  return useMutation({
    mutationFn: async (report) => {
      const { data, error } = await supabase.functions.invoke(
        'report-problem',
        { body: reportBody(report) }
      );
      if (error) {
        const status = error.context?.status;
        const failed = new Error(
          status === 429 ? 'rate_limited' : 'delivery_failed'
        );
        failed.code = status === 429 ? 'rate_limited' : 'delivery_failed';
        throw failed;
      }
      return data;
    },
  });
}
