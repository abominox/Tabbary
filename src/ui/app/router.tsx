import type { ComponentType } from 'react';
import { SidePanel } from '../surfaces/SidePanel';
import { FullTab } from '../surfaces/FullTab';
import { Popup } from '../surfaces/Popup';
import { DedicatedWindow } from '../surfaces/DedicatedWindow';
import { Options } from '../surfaces/Options';
import { Onboarding } from '../surfaces/Onboarding';
import { Tags } from '../surfaces/Tags';
import { Bookmarks } from '../surfaces/Bookmarks';

export type Surface =
  | 'popup'
  | 'full-tab'
  | 'dedicated-window'
  | 'side-panel'
  | 'options'
  | 'onboarding'
  | 'tags'
  | 'bookmarks';

const surfaceMap: Record<Surface, ComponentType> = {
  popup: Popup,
  'full-tab': FullTab,
  'dedicated-window': DedicatedWindow,
  'side-panel': SidePanel,
  options: Options,
  onboarding: Onboarding,
  tags: Tags,
  bookmarks: Bookmarks,
};

interface SurfaceRouterProps {
  surface: Surface;
}

export function SurfaceRouter({ surface }: SurfaceRouterProps) {
  const Component = surfaceMap[surface];
  return <Component />;
}