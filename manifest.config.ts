import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  minimum_chrome_version: '116',
  name: '__MSG_extName__',
  version: '0.9.0',
  description: '__MSG_extDescription__',
  default_locale: 'en',
  permissions: [
    'tabs',
    'storage',
    'unlimitedStorage',
    'tabGroups',
    'sidePanel',
    'alarms',
    'favicon',
  ],
  // bookmarks is optional: only requested when the user imports Chrome bookmarks.
  // Only permissions actually used today. Unused permissions invite reviewer
  // questions and widen the install prompt for no benefit.
  optional_permissions: ['history', 'bookmarks'],
  // Sync is opt-in: no host access is requested at install. The origin is
  // granted through permissions.request() when the user configures a server.
  host_permissions: [],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  background: {
    service_worker: 'src/sw/index.ts',
    type: 'module',
  },
  action: {
    default_title: '__MSG_extName__',
    default_popup: 'popup.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  options_ui: {
    page: 'options.html',
    open_in_tab: true,
  },
  commands: {
    'open-side-panel': {
      suggested_key: {
        default: 'Alt+A',
      },
      description: '__MSG_commandOpenSidePanel__',
    },
    'open-full-tab': {
      suggested_key: {
        default: 'Alt+S',
      },
      description: '__MSG_commandOpenFullTab__',
    },
    'open-tags': {
      suggested_key: {
        default: 'Alt+T',
      },
      description: '__MSG_commandOpenTags__',
    },
    'open-bookmarks': {
      suggested_key: {
        default: 'Alt+B',
      },
      description: '__MSG_commandOpenBookmarks__',
    },
  },
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  incognito: 'spanning',
});