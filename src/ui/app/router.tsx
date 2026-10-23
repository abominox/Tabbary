import type { ComponentType } from 'react';
import { SidePanel } from '../surfaces/SidePanel';
import { FullTab } from '../surfaces/FullTab';
import { Popup } from '../surfaces/Popup';
import { DedicatedWindow } from '../surfaces/DedicatedWindow';
import { Options } from '../surfaces/Options';
import { Onboarding } from '../surfaces/Onboarding';

export type Surface = 'popup' | 'full-tab' | 'dedicated-window' | 'side-panel' | 'options' | 'onboarding';

const surfaceMap: Record<Surface, ComponentType> = {
  popup: Popup,
  'full-tab': FullTab,
  'dedicated-window': DedicatedWindow,
  'side-panel': SidePanel,
  options: Options,
  onboarding: Onboarding,
};

interface SurfaceRouterProps {
  surface: Surface;
}

export function SurfaceRouter({ surface }: SurfaceRouterProps) {
  const Component = surfaceMap[surface];
  return <Component />;
}