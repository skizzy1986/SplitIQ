import { createContext, useContext } from 'react';

// The authenticated actor, supplied by AuthGate. Null never means "all users".
export const SessionOwnerContext = createContext(null);

export function useSessionOwner() {
  return useContext(SessionOwnerContext);
}
