export { cn, uuid, debounce, formatRelativeTime, clamp } from './utils';
export { getFaviconUrl, extractFaviconViaOffscreen } from './favicon';
export { discardTab, discardTabs, isDiscardable } from './discard';
export {
  requestSyncHostPermission,
  hasHostPermission,
  removeHostPermission,
} from './permissions';
export { sessionMatchesQuery, type SearchScope } from './search';
