import { Popup as PopupView } from '../components/Popup';

/**
 * Popup surface — the toolbar action's quick view.
 * Stays compact so it fits Chrome's popup bounds.
 */
export function Popup() {
  return <PopupView compact />;
}
