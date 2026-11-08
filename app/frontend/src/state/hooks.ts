import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Studio } from './studio';

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error('useStudio outside StudioContext');
  return studio;
}

/** Re-render whenever the character, scene or history changes. */
export function useStudioVersion(): number {
  const studio = useStudio();
  return useSyncExternalStore(studio.subscribe, studio.getVersion);
}
