export type DarkMode = 'system' | 'light' | 'dark';
export type RotateAmount = 15 | 30 | 45 | 90 | 180;

export interface Preferences {
  version:      1;
  darkMode:     DarkMode;
  rotateAmount: RotateAmount;
}

export const DARK_MODE_VALUES: readonly DarkMode[] = ['system', 'light', 'dark'];
export const ROTATE_AMOUNT_VALUES: readonly RotateAmount[] = [15, 30, 45, 90, 180];

export const DEFAULT_PREFERENCES: Preferences = {
  version:      1,
  darkMode:     'system',
  rotateAmount: 45,
};
