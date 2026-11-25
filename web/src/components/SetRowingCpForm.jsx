import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';
import { setRowingCp } from '../utils/setRowingCp.js';
import { MIN_CP, MAX_CP } from '../utils/firstRunGuide.js';

// Testers-only CP entry (#797). Copy is passed in so the form stays out of
// the message catalogs.
export default function SetRowingCpForm({ copy, currentCp }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(
    currentCp != null ? String(currentCp) : ''
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const result = await setRowingCp(value);
    setBusy(false);
    if (!result.ok) {
      setStatus(result.cause === 'invalid' ? 'invalid' : 'error');
      return;
    }
    setStatus('saved');
    setValue(String(result.watts));
    queryClient.invalidateQueries({ queryKey: ['anchors'] });
  };

  return (
    <form onSubmit={save} style={{ marginTop: SPACE.md }}>
      <label
        htmlFor="testers-rowing-cp"
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
          id="testers-rowing-cp"
          type="number"
          inputMode="numeric"
          min={MIN_CP}
          max={MAX_CP}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            flex: 1,
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
      {status === 'invalid' && (
        <div
          role="alert"
          style={{ color: THEME.critical, fontSize: 11, marginTop: 6 }}
        >
          {copy.cpMissing}
        </div>
      )}
      {status === 'error' && (
        <div
          role="alert"
          style={{ color: THEME.critical, fontSize: 11, marginTop: 6 }}
        >
          {copy.cpError}
        </div>
      )}
      {status === 'saved' && (
        <div
          role="status"
          style={{ color: THEME.positive, fontSize: 11, marginTop: 6 }}
        >
          {copy.cpSaved}
        </div>
      )}
    </form>
  );
}
