import { msg } from '@lingui/core/macro';
import { httpsUrlOrNull } from '../../utils/sessionPage.js';

// The one file in the session page's components that names a data source. The
// page and its other components are source-neutral and render what this
// returns; a new source (data the app captures itself) adds its words here.

// Strava's brand guidelines require this exact link text, so it is not
// translated.
const STRAVA_LINK_TEXT = 'View on Strava';

// Where the trace came from: { line, link } or null for a source with nothing
// to say (the page still shows its measured-versus-derived caption). The link
// target is `series.info.href`, supplied by the source's server side; no URL
// is ever assembled here. Without one, there is no link.
export function provenanceCopy(source, { href = null, origin = null } = {}) {
  if (source !== 'strava') return null;
  return {
    line:
      origin === 'adopted'
        ? msg({
            message: 'Summary from your log; trace from Strava.',
            comment: 'Session page provenance: the row was logged in the app',
          })
        : msg({
            message: 'Imported from Strava.',
            comment: 'Session page provenance',
          }),
    link: httpsUrlOrNull(href)
      ? { href: httpsUrlOrNull(href), text: STRAVA_LINK_TEXT }
      : null,
  };
}

const STRAVA_UNAVAILABLE = {
  not_connected: {
    message: msg({
      message:
        'Strava is not connected, so there is no trace for this session.',
      comment: 'Session page: trace unavailable',
    }),
    settings: true,
  },
  auth_failed: {
    message: msg({
      message: 'Strava refused the current grant, so the trace did not load.',
      comment: 'Session page: trace unavailable',
    }),
    settings: true,
  },
  rate_limited: {
    message: msg({
      message:
        'Strava’s request limit is reached. The trace can load again after {time}.',
      comment: 'Session page: trace unavailable. {time} is a clock time, HH:MM',
    }),
    messageNoTime: msg({
      message:
        'Strava’s request limit is reached. The trace can load again later.',
      comment: 'Session page: trace unavailable',
    }),
  },
  gone: {
    message: msg({
      message: 'This activity is no longer on Strava, so there is no trace.',
      comment: 'Session page: trace unavailable',
    }),
  },
  attribution_pending: {
    message: msg({
      message:
        'This activity was recorded on a Garmin device. Its trace appears once Garmin attribution is in place.',
      comment: 'Session page: trace unavailable. Garmin is a brand name',
    }),
  },
};

const GENERIC_UNAVAILABLE = {
  message: msg({
    message: 'The trace for this session is not available.',
    comment: 'Session page: trace unavailable, unknown source',
  }),
};

// The words for an unavailable trace: { message, messageNoTime?, settings? }.
export function unavailableCopy(source, reason) {
  if (source === 'strava' && STRAVA_UNAVAILABLE[reason]) {
    return STRAVA_UNAVAILABLE[reason];
  }
  return GENERIC_UNAVAILABLE;
}
