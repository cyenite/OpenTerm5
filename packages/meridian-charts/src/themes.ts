// One Meridian theme colours both the application around the charts (as CSS custom properties)
// and the charts themselves, so a host never has to keep two palettes in step.

export interface MeridianUiTokens {
  chrome: string;
  chromeBlur: string;
  surface: string;
  surfaceAlt: string;
  surfaceRaised: string;
  border: string;
  borderSoft: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  selection: string;
  hover: string;
  buy: string;
  sell: string;
  profit: string;
  loss: string;
  up: string;
  down: string;
  good: string;
  warn: string;
  bad: string;
  switchOn: string;
  controlShadow: string;
  shadow: string;
  focus: string;
}

export interface MeridianChartTokens {
  background: string;
  // When set, the background fades from `background` at the top to this colour at the bottom.
  backgroundGradient?: string;
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  line: string;
  crosshair: string;
  askLine: string;
  fontFamily: string;
  // Colours handed to studies a host draws itself, in order of use.
  palette: readonly string[];
}

export type MeridianMode = 'dark' | 'light';

export interface MeridianTheme {
  readonly id: string;
  readonly label: string;
  readonly mode: MeridianMode;
  readonly ui: MeridianUiTokens;
  readonly chart: MeridianChartTokens;
}

export interface ThemePatch {
  id: string;
  label: string;
  mode?: MeridianMode;
  ui?: Partial<MeridianUiTokens>;
  chart?: Partial<MeridianChartTokens>;
}

const fontFamily = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif";
const palette = ['#2962ff', '#ff9800', '#e91e63', '#00bcd4', '#9c27b0', '#4caf50', '#ffeb3b'];

// OpenTerm5's original neutral dark palette: greys without a blue cast.
export const meridianDark: MeridianTheme = {
  id: 'meridian-dark',
  label: 'Meridian Dark',
  mode: 'dark',
  ui: {
    chrome: '#232325',
    chromeBlur: 'rgb(35 35 37 / 0.8)',
    surface: '#1c1c1e',
    surfaceAlt: '#242426',
    surfaceRaised: '#2c2c2e',
    border: 'rgb(255 255 255 / 0.16)',
    borderSoft: 'rgb(255 255 255 / 0.08)',
    text: '#f5f5f7',
    muted: '#98989d',
    accent: '#0a84ff',
    accentText: '#ffffff',
    accentSoft: 'rgb(10 132 255 / 0.2)',
    selection: 'rgb(10 132 255 / 0.28)',
    hover: 'rgb(255 255 255 / 0.06)',
    buy: '#3d8bff',
    sell: '#ff5249',
    profit: '#3d8bff',
    loss: '#ff6b63',
    up: '#3d8bff',
    down: '#ff6b63',
    good: '#30d158',
    warn: '#ffb340',
    bad: '#ff6961',
    switchOn: '#30d158',
    controlShadow: '0 0.5px 1px rgb(0 0 0 / 0.4), inset 0 0.5px 0 rgb(255 255 255 / 0.08), inset 0 0 0 0.5px rgb(255 255 255 / 0.08)',
    shadow: '0 12px 34px rgb(0 0 0 / 0.5), 0 0 0 0.5px rgb(255 255 255 / 0.12)',
    focus: '0 0 0 3px rgb(10 132 255 / 0.45)',
  },
  chart: {
    background: '#1c1c1e',
    text: '#b4b4b9',
    grid: '#2a2a2d',
    border: '#3a3a3c',
    up: '#089981',
    down: '#f23645',
    line: '#0a84ff',
    crosshair: '#8e8e93',
    askLine: '#ff5249',
    fontFamily,
    palette,
  },
};

export const meridianLight: MeridianTheme = {
  id: 'meridian-light',
  label: 'Meridian Light',
  mode: 'light',
  ui: {
    chrome: '#f0f3fa',
    chromeBlur: 'rgb(240 243 250 / 0.8)',
    surface: '#ffffff',
    surfaceAlt: '#f8f9fd',
    surfaceRaised: '#ffffff',
    border: 'rgb(19 23 34 / 0.14)',
    borderSoft: 'rgb(19 23 34 / 0.07)',
    text: '#131722',
    muted: '#6a6d78',
    accent: '#2962ff',
    accentText: '#ffffff',
    accentSoft: 'rgb(41 98 255 / 0.12)',
    selection: 'rgb(41 98 255 / 0.16)',
    hover: 'rgb(19 23 34 / 0.05)',
    buy: '#2962ff',
    sell: '#f23645',
    profit: '#089981',
    loss: '#f23645',
    up: '#089981',
    down: '#f23645',
    good: '#089981',
    warn: '#e65100',
    bad: '#d50000',
    switchOn: '#2962ff',
    controlShadow: '0 0.5px 1.5px rgb(19 23 34 / 0.16), inset 0 0 0 0.5px rgb(19 23 34 / 0.1)',
    shadow: '0 10px 30px rgb(19 23 34 / 0.16), 0 0 0 0.5px rgb(19 23 34 / 0.12)',
    focus: '0 0 0 3px rgb(41 98 255 / 0.3)',
  },
  chart: {
    background: '#ffffff',
    text: '#131722',
    grid: '#f0f3fa',
    border: '#e0e3eb',
    up: '#089981',
    down: '#f23645',
    line: '#2962ff',
    crosshair: '#9598a1',
    askLine: '#f23645',
    fontFamily,
    palette,
  },
};

export const meridianMidnight: MeridianTheme = {
  id: 'meridian-midnight',
  label: 'Meridian Midnight',
  mode: 'dark',
  ui: {
    ...meridianDark.ui,
    chrome: '#0b0e14',
    chromeBlur: 'rgb(11 14 20 / 0.84)',
    surface: '#0e1219',
    surfaceAlt: '#121722',
    surfaceRaised: '#1a2030',
    text: '#cdd6f4',
    muted: '#7f849c',
    accent: '#38c0fd',
    accentText: '#06121c',
    accentSoft: 'rgb(56 192 253 / 0.18)',
    selection: 'rgb(56 192 253 / 0.24)',
    buy: '#38c0fd',
    switchOn: '#38c0fd',
    up: '#26a69a',
    down: '#ef5350',
    profit: '#26a69a',
    loss: '#ef5350',
    good: '#26a69a',
    bad: '#ef5350',
    focus: '0 0 0 3px rgb(56 192 253 / 0.4)',
  },
  chart: {
    ...meridianDark.chart,
    background: '#0b0e14',
    text: '#a6adc8',
    grid: '#151a24',
    border: '#232838',
    up: '#26a69a',
    down: '#ef5350',
    line: '#38c0fd',
    askLine: '#ef5350',
  },
};

const registry = new Map<string, MeridianTheme>([meridianDark, meridianLight, meridianMidnight].map((theme) => [theme.id, theme]));

export const defaultThemeId = meridianDark.id;

// 'system' follows the operating system between the default dark and light themes.
export const systemThemeId = 'system';

export function listThemes(): MeridianTheme[] {
  return [...registry.values()];
}

export function getTheme(id: string): MeridianTheme | undefined {
  return registry.get(id);
}

export function registerTheme(theme: MeridianTheme): () => void {
  if (theme.id === systemThemeId) throw new Error(`"${systemThemeId}" is reserved for following the operating system.`);
  registry.set(theme.id, theme);
  return () => { if (registry.get(theme.id) === theme) registry.delete(theme.id); };
}

export function createTheme(base: MeridianTheme, patch: ThemePatch): MeridianTheme {
  return {
    id: patch.id,
    label: patch.label,
    mode: patch.mode ?? base.mode,
    ui: { ...base.ui, ...patch.ui },
    chart: { ...base.chart, ...patch.chart },
  };
}

export function isThemePreference(value: unknown): value is string {
  return value === systemThemeId || typeof value === 'string' && registry.has(value);
}

export function resolveTheme(preference: string, prefersDark: boolean): MeridianTheme {
  if (preference === systemThemeId) return prefersDark ? meridianDark : meridianLight;
  return registry.get(preference) ?? meridianDark;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export function themeCssVariables(theme: MeridianTheme): Record<string, string> {
  return Object.fromEntries(Object.entries(theme.ui).map(([key, value]) => [`--${kebab(key)}`, value]));
}

export function applyTheme(theme: MeridianTheme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(themeCssVariables(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = theme.mode;
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
}
