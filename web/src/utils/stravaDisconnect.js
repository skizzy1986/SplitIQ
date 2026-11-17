// The words of the Strava disconnect flow (#630): what a disconnect would
// remove, and what it did. Pure: no React, no Supabase, no THEME — `tone` is a
// THEME KEY NAME the panel maps, the same contract as stravaStatus.js.
//
// Words go through Lingui at CALL time, never at module scope. Counts are
// plain placeholders, not ICU `#`, so they are never locale-grouped.

import { plural, t } from '@lingui/core/macro';

const n = (value) => (Number.isInteger(value) && value > 0 ? value : 0);

export function describeDisconnectPreview({
  toDelete,
  toKeep,
  toRestore,
} = {}) {
  const del = n(toDelete);
  const keep = n(toKeep);
  const restore = n(toRestore);
  const lines = [];

  if (del > 0) {
    lines.push(
      plural(del, {
        one: `${del} imported session will be deleted.`,
        other: `${del} imported sessions will be deleted.`,
      })
    );
  }
  if (keep > 0) {
    lines.push(
      plural(keep, {
        one: `${keep} imported session with your own sRPE or notes will be kept, without Strava power and heart rate.`,
        other: `${keep} imported sessions with your own sRPE or notes will be kept, without Strava power and heart rate.`,
      })
    );
  }
  if (restore > 0) {
    lines.push(
      plural(restore, {
        one: `Strava power and heart rate will be removed from ${restore} session you logged yourself.`,
        other: `Strava power and heart rate will be removed from ${restore} sessions you logged yourself.`,
      })
    );
  }
  lines.push(
    lines.length === 0
      ? t`Nothing in your log came from Strava; nothing will be removed.`
      : t`Your training load will be recalculated. This cannot be undone.`
  );

  return {
    heading: t`Disconnect Strava and delete its data?`,
    lines,
    confirmLabel: t({
      message: 'Disconnect and delete',
      comment:
        'Button that confirms disconnecting Strava and deleting its data',
    }),
  };
}

export function describeDisconnectResult({
  removed,
  kept,
  restored,
  revocation,
} = {}) {
  const del = n(removed);
  const keep = n(kept);
  const restore = n(restored);
  const parts = [t`Strava disconnected.`];

  if (del > 0) {
    parts.push(
      plural(del, {
        one: `${del} imported session deleted.`,
        other: `${del} imported sessions deleted.`,
      })
    );
  }
  if (keep > 0) {
    parts.push(
      plural(keep, {
        one: `${keep} imported session kept, without Strava power and heart rate.`,
        other: `${keep} imported sessions kept, without Strava power and heart rate.`,
      })
    );
  }
  if (restore > 0) {
    parts.push(
      plural(restore, {
        one: `Strava power and heart rate removed from ${restore} session you logged yourself.`,
        other: `Strava power and heart rate removed from ${restore} sessions you logged yourself.`,
      })
    );
  }
  if (del + keep + restore === 0) {
    parts.push(t`Nothing in your log came from Strava.`);
  }

  // Anything but a confirmed revocation or an already-ended grant is treated as
  // a failure: the user is told to check Strava rather than reassured.
  let tone = 'positive';
  if (revocation === 'revoked') {
    parts.push(t`Access at Strava revoked.`);
  } else if (revocation === 'not_attempted') {
    parts.push(t`SplitIQ's access at Strava had already ended.`);
  } else {
    tone = 'caution';
    parts.push(
      t`Strava did not confirm the revocation. Remove SplitIQ in Strava → Settings → My Apps.`
    );
  }

  return { tone, text: parts.join(' ') };
}
