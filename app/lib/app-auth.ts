/** localStorage key for simple app gate (not cryptographically secure). */
export const APP_AUTH_STORAGE_KEY = "edifis-app-auth";

export const APP_AUTH_STORAGE_VALUE = "granted";

export function clearAppAuth(): void {
  try {
    window.localStorage.removeItem(APP_AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
