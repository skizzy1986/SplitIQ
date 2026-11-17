import { act, renderHook } from '@testing-library/react';
import { useHashSessionId } from '../useHashSessionId.js';

afterEach(() => {
  window.location.hash = '';
});

const go = (hash) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
  });

describe('useHashSessionId', () => {
  it('reads the id from #/session/<id> and follows hash changes', () => {
    window.location.hash = '#/session/31';
    const { result } = renderHook(() => useHashSessionId());
    expect(result.current).toBe(31);
    go('#/session/32');
    expect(result.current).toBe(32);
    go('#/session/abc');
    expect(result.current).toBeNull();
    go('#/progress');
    expect(result.current).toBeNull();
  });
});
