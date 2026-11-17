import { useEffect, useState } from 'react';
import { sessionIdFromHash } from '../utils/sessionPage.js';

// The phone shell's route reader keeps only the first hash segment, so the
// session page reads its id here. Null when the hash holds no valid id.
export function useHashSessionId() {
  const [id, setId] = useState(() => sessionIdFromHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setId(sessionIdFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return id;
}
