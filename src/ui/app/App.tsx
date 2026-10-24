import { useMemo } from 'react';
import { SurfaceRouter } from './router';
import type { Surface } from './router';

interface AppProps {
  surface: string;
}

export function App({ surface }: AppProps) {
  const validSurface = useMemo<Surface>(() => {
    const valid: Surface[] = ['popup', 'full-tab', 'dedicated-window', 'side-panel', 'options', 'onboarding', 'tags'];
    return valid.includes(surface as Surface) ? (surface as Surface) : 'side-panel';
  }, [surface]);

  return (
    <div className="h-full w-full bg-surface-base text-text-primary antialiased">
      <SurfaceRouter surface={validSurface} />
    </div>
  );
}