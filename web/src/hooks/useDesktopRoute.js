import { useCallback, useEffect, useState } from 'react';
import { desktopRoute } from '../utils/desktopRoute.js';

export function useDesktopRoute(initial = null) {
  const [route, setRoute] = useState(() =>
    desktopRoute(initial ?? window.location.hash)
  );
  useEffect(() => {
    const canonicalize = (next) => {
      const hash = window.location.hash;
      const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
      if (hash.split('?')[0] !== `#/${next.path}`) {
        const { pathname, search } = window.location;
        window.history.replaceState(
          null,
          '',
          `${pathname}${search}#/${next.path}${query}`
        );
      }
    };
    // replaceState does not dispatch hashchange. Normalize legacy/invalid links
    // without adding a phantom Back entry; the initial OAuth route wins once.
    canonicalize(desktopRoute(initial ?? window.location.hash));
    const onChange = () => {
      const next = desktopRoute(window.location.hash);
      setRoute(next);
      canonicalize(next);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [initial]);

  const navigate = useCallback((path) => {
    const next = desktopRoute(path);
    setRoute(next);
    if (window.location.hash !== `#/${next.path}`)
      window.location.hash = `#/${next.path}`;
  }, []);
  return [route, navigate];
}
