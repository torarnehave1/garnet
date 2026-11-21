// Whether the controls (the dock and the info panels) are folded away, remembered in this browser.
const HIDE_KEY = 'garnet.dockHidden'
export function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}
export function saveHidden(v: boolean) {
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0')
  } catch {
    /* storage may be unavailable; the choice then lasts this visit only */
  }
}
