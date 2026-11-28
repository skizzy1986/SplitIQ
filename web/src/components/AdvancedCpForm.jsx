import { useState } from 'react';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';
import { MIN_CP, MAX_CP } from '../utils/firstRunGuide.js';

// The rowing CP form in Settings > Advanced (#819 S4, H 38). Props in, no
// Supabase calls: onSave(raw) resolves to { ok, watts } or { ok: false,
// cause: 'invalid' | 'stale' | 'error' }.
//
// Seeding: the parent mounts this only once the anchors read has loaded, so
// the field starts from the saved CP rather than blank (the old form seeded
// once at mount, before the read had answered). After that the field is the
// user's: a background refetch never overwrites what they are typing.
export default function AdvancedCpForm({ copy, currentCp, onSave }) {
  const [value, setValue] = useState(
    currentCp != null ? String(currentCp) : ''
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const result = await onSave(value);
    setBusy(false);
    if (!result.ok) {
      setStatus(result.cause ?? 'error');
      return;
    }
    setStatus('saved');
    setValue(String(result.watts));
  };

  const message = {
    invalid: copy.cpMissing,
    stale: copy.cpStale,
    error: copy.cpError,
  }[status];

  return (
    <form onSubmit={save}>
      <label
        htmlFor="advanced-rowing-cp"
        style={{
          display: 'block',
          fontSize: TYPE.micro.size,
          letterSpacing: TYPE.micro.letterSpacing,
          color: THEME.muted,
          marginBottom: 4,
        }}
      >
        {copy.cpLabel}
      </label>
      <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'stretch' }}>
        <input
          id="advanced-rowing-cp"
          type="number"
          inputMode="numeric"
          min={MIN_CP}
          max={MAX_CP}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: THEME.field,
            border: `1px solid ${THEME.textFaint}`,
            borderRadius: RADIUS.sm,
            padding: '11px 12px',
            fontSize: TYPE.body.size,
            color: THEME.text,
            fontFamily: FONT.mono,
            boxSizing: 'border-box',
            minHeight: 44,
          }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            minHeight: 44,
            padding: '0 16px',
            border: `1px solid ${THEME.border}`,
            borderRadius: RADIUS.sm,
            background: busy ? THEME.border : THEME.raised,
            color: THEME.text,
            fontFamily: FONT.sans,
            fontSize: TYPE.body.size,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {copy.cpSave}
        </button>
      </div>
      {message && (
        <div
          role="alert"
          style={{
            color: THEME.critical,
            fontSize: TYPE.bodySm.size,
            marginTop: 6,
          }}
        >
          {message}
        </div>
      )}
      {status === 'saved' && (
        <div
          role="status"
          style={{
            color: THEME.positive,
            fontSize: TYPE.bodySm.size,
            marginTop: 6,
          }}
        >
          {copy.cpSaved}
        </div>
      )}
    </form>
  );
}
