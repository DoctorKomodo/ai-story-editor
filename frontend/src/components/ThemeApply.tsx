import { useEffect } from 'react';
import { DEFAULT_SETTINGS, useUserSettingsQuery } from '@/hooks/useUserSettings';
import {
  applyProseFont,
  applyProseLineHeight,
  applyProseSize,
  applyTheme,
  fontIdFromStored,
  fontStackFor,
} from '@/lib/themeApply';
import { useSessionStore } from '@/store/session';

/**
 * Side-effect-only component that mirrors persistent theme + prose tokens
 * from the user-settings cache onto `document.documentElement`. Mounted at
 * app root so the tokens repaint as soon as the settings query resolves at
 * login — without waiting for the user to open the Appearance tab.
 *
 * The query is gated on `status === 'authenticated'` so unauth pages
 * (login / register) don't fire an unguarded fetch (which would also
 * consume a queued mock response in tests). When unauthenticated the
 * component returns null without applying anything; the document keeps
 * its CSS-default tokens.
 */
export function ThemeApply(): null {
  const status = useSessionStore((s) => s.status);
  const enabled = status === 'authenticated';
  const { data } = useUserSettingsQuery({ enabled });
  const settings = data ?? DEFAULT_SETTINGS;
  useEffect(() => {
    if (!enabled) return;
    applyTheme(settings.theme);
    applyProseFont(fontStackFor(fontIdFromStored(settings.prose.font)));
    applyProseSize(settings.prose.size);
    applyProseLineHeight(settings.prose.lineHeight);
  }, [
    enabled,
    settings.theme,
    settings.prose.font,
    settings.prose.size,
    settings.prose.lineHeight,
  ]);
  return null;
}
