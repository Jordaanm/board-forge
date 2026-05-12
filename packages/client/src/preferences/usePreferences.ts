import { useContext } from 'react';
import { PreferencesContext, type PreferencesContextValue } from './PreferencesContext';

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (ctx === null) {
    throw new Error('usePreferences must be used inside <PreferencesProvider>');
  }
  return ctx;
}
