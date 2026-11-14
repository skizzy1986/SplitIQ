import { msg } from '@lingui/core/macro';
import { durationDisplay } from './duration.js';

// sessions.duration as the session lists show it. The unit sits inside the
// message, so the translator owns its spacing; a clock and an unparsed entry
// render as stored. '' when there is nothing to show.
export function durationLabel(value, i18n) {
  const d = durationDisplay(value);
  if (!d) return '';
  if (d.kind !== 'minutes') return d.text;
  const { minutes } = d;
  return i18n._(
    msg({ message: `${minutes} min`, comment: 'A duration in minutes' })
  );
}
