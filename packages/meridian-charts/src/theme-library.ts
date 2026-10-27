import type { ThemePatch } from './themes';

// Built-in themes beyond Meridian's own, each patched over Meridian Dark or Light by its mode. The
// application themes port popular editor palettes (credited in THIRD_PARTY_NOTICES.md). Where an
// original colour was too faint for prices and P/L text on its surface (under 4.5:1), only that
// text colour was darkened or lightened; candles keep the original palette. Chart-only themes are
// offered as a chart's own theme and not for the whole window.
export const libraryThemes: readonly ThemePatch[] = [
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    mode: 'dark',
    ui: {
      chrome: '#16161e', chromeBlur: 'rgb(22 22 30 / 0.84)', surface: '#1a1b26', surfaceAlt: '#1f2030', surfaceRaised: '#24283b',
      border: 'rgb(192 202 245 / 0.15)', borderSoft: 'rgb(192 202 245 / 0.08)', text: '#c0caf5', muted: '#8a92bd', accent: '#7aa2f7',
      accentText: '#16161e', accentSoft: 'rgb(122 162 247 / 0.2)', selection: 'rgb(122 162 247 / 0.28)',
      hover: 'rgb(192 202 245 / 0.06)', buy: '#7aa2f7', sell: '#f7768e', profit: '#73daca', loss: '#f7768e', up: '#73daca',
      down: '#f7768e', good: '#9ece6a', warn: '#e0af68', bad: '#f7768e', switchOn: '#9ece6a',
      focus: '0 0 0 3px rgb(122 162 247 / 0.45)',
    },
    chart: {
      background: '#1a1b26', text: '#a9b1d6', grid: '#222433', border: '#2f334d', up: '#73daca', down: '#f7768e', line: '#7aa2f7',
      crosshair: '#565f89', askLine: '#f7768e',
      palette: ['#7aa2f7', '#ff9e64', '#bb9af7', '#7dcfff', '#9d7cd8', '#9ece6a', '#e0af68'],
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    mode: 'dark',
    ui: {
      chrome: '#181825', chromeBlur: 'rgb(24 24 37 / 0.84)', surface: '#1e1e2e', surfaceAlt: '#232336', surfaceRaised: '#313244',
      border: 'rgb(205 214 244 / 0.15)', borderSoft: 'rgb(205 214 244 / 0.08)', text: '#cdd6f4', muted: '#9399b2', accent: '#cba6f7',
      accentText: '#11111b', accentSoft: 'rgb(203 166 247 / 0.2)', selection: 'rgb(203 166 247 / 0.28)',
      hover: 'rgb(205 214 244 / 0.06)', buy: '#89b4fa', sell: '#f38ba8', profit: '#a6e3a1', loss: '#f38ba8', up: '#a6e3a1',
      down: '#f38ba8', good: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8', switchOn: '#a6e3a1',
      focus: '0 0 0 3px rgb(203 166 247 / 0.45)',
    },
    chart: {
      background: '#1e1e2e', text: '#a6adc8', grid: '#27273a', border: '#313244', up: '#a6e3a1', down: '#f38ba8', line: '#89b4fa',
      crosshair: '#6c7086', askLine: '#f38ba8',
      palette: ['#89b4fa', '#fab387', '#f5c2e7', '#94e2d5', '#cba6f7', '#a6e3a1', '#f9e2af'],
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    mode: 'dark',
    ui: {
      chrome: '#272c36', chromeBlur: 'rgb(39 44 54 / 0.84)', surface: '#2e3440', surfaceAlt: '#333a47', surfaceRaised: '#3b4252',
      border: 'rgb(236 239 244 / 0.15)', borderSoft: 'rgb(236 239 244 / 0.08)', text: '#eceff4', muted: '#a3acbd', accent: '#88c0d0',
      accentText: '#242933', accentSoft: 'rgb(136 192 208 / 0.2)', selection: 'rgb(136 192 208 / 0.28)',
      hover: 'rgb(236 239 244 / 0.06)', buy: '#81a1c1', sell: '#cf898f', profit: '#a3be8c', loss: '#cf898f', up: '#a3be8c',
      down: '#cf898f', good: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a', switchOn: '#a3be8c',
      focus: '0 0 0 3px rgb(136 192 208 / 0.45)',
    },
    chart: {
      background: '#2e3440', text: '#d8dee9', grid: '#353c4a', border: '#434c5e', up: '#a3be8c', down: '#bf616a', line: '#88c0d0',
      crosshair: '#616e88', askLine: '#bf616a',
      palette: ['#81a1c1', '#d08770', '#ebcb8b', '#88c0d0', '#b48ead', '#a3be8c', '#8fbcbb'],
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    mode: 'dark',
    ui: {
      chrome: '#21222c', chromeBlur: 'rgb(33 34 44 / 0.84)', surface: '#282a36', surfaceAlt: '#2c2e3b', surfaceRaised: '#343746',
      border: 'rgb(248 248 242 / 0.15)', borderSoft: 'rgb(248 248 242 / 0.08)', text: '#f8f8f2', muted: '#a5acc8', accent: '#bd93f9',
      accentText: '#191a21', accentSoft: 'rgb(189 147 249 / 0.2)', selection: 'rgb(189 147 249 / 0.28)',
      hover: 'rgb(248 248 242 / 0.06)', buy: '#8be9fd', sell: '#ff6e6e', profit: '#50fa7b', loss: '#ff6e6e', up: '#50fa7b',
      down: '#ff6e6e', good: '#50fa7b', warn: '#ffb86c', bad: '#ff5555', switchOn: '#50fa7b',
      focus: '0 0 0 3px rgb(189 147 249 / 0.45)',
    },
    chart: {
      background: '#282a36', text: '#bfc3d9', grid: '#30323f', border: '#44475a', up: '#50fa7b', down: '#ff5555', line: '#bd93f9',
      crosshair: '#6272a4', askLine: '#ff5555',
      palette: ['#8be9fd', '#ffb86c', '#ff79c6', '#f1fa8c', '#bd93f9', '#50fa7b', '#6272a4'],
    },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    mode: 'dark',
    ui: {
      chrome: '#191724', chromeBlur: 'rgb(25 23 36 / 0.84)', surface: '#1f1d2e', surfaceAlt: '#232136', surfaceRaised: '#26233a',
      border: 'rgb(224 222 244 / 0.15)', borderSoft: 'rgb(224 222 244 / 0.08)', text: '#e0def4', muted: '#908caa', accent: '#ebbcba',
      accentText: '#191724', accentSoft: 'rgb(235 188 186 / 0.2)', selection: 'rgb(235 188 186 / 0.28)',
      hover: 'rgb(224 222 244 / 0.06)', buy: '#9ccfd8', sell: '#eb6f92', profit: '#9ccfd8', loss: '#eb6f92', up: '#9ccfd8',
      down: '#eb6f92', good: '#9ccfd8', warn: '#f6c177', bad: '#eb6f92', switchOn: '#9ccfd8',
      focus: '0 0 0 3px rgb(235 188 186 / 0.45)',
    },
    chart: {
      background: '#191724', text: '#908caa', grid: '#211f2e', border: '#2a273f', up: '#9ccfd8', down: '#eb6f92', line: '#c4a7e7',
      crosshair: '#6e6a86', askLine: '#eb6f92',
      palette: ['#3e8fb0', '#f6c177', '#ebbcba', '#9ccfd8', '#c4a7e7', '#31748f', '#e0def4'],
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    mode: 'dark',
    ui: {
      chrome: '#1d2021', chromeBlur: 'rgb(29 32 33 / 0.84)', surface: '#282828', surfaceAlt: '#2c2a29', surfaceRaised: '#32302f',
      border: 'rgb(235 219 178 / 0.15)', borderSoft: 'rgb(235 219 178 / 0.08)', text: '#ebdbb2', muted: '#a89984', accent: '#fabd2f',
      accentText: '#1d2021', accentSoft: 'rgb(250 189 47 / 0.2)', selection: 'rgb(250 189 47 / 0.28)',
      hover: 'rgb(235 219 178 / 0.06)', buy: '#83a598', sell: '#fb5440', profit: '#b8bb26', loss: '#fb5440', up: '#b8bb26',
      down: '#fb5440', good: '#b8bb26', warn: '#fe8019', bad: '#fb4934', switchOn: '#b8bb26',
      focus: '0 0 0 3px rgb(250 189 47 / 0.45)',
    },
    chart: {
      background: '#282828', text: '#bdae93', grid: '#312f2e', border: '#3c3836', up: '#b8bb26', down: '#fb4934', line: '#83a598',
      crosshair: '#7c6f64', askLine: '#fb4934',
      palette: ['#83a598', '#fe8019', '#8ec07c', '#fabd2f', '#d3869b', '#b8bb26', '#bdae93'],
    },
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    mode: 'dark',
    ui: {
      chrome: '#16161d', chromeBlur: 'rgb(22 22 29 / 0.84)', surface: '#1f1f28', surfaceAlt: '#23232e', surfaceRaised: '#2a2a37',
      border: 'rgb(220 215 186 / 0.15)', borderSoft: 'rgb(220 215 186 / 0.08)', text: '#dcd7ba', muted: '#a09d8c', accent: '#7e9cd8',
      accentText: '#16161d', accentSoft: 'rgb(126 156 216 / 0.2)', selection: 'rgb(126 156 216 / 0.28)',
      hover: 'rgb(220 215 186 / 0.06)', buy: '#7fb4ca', sell: '#e46876', profit: '#98bb6c', loss: '#e46876', up: '#98bb6c',
      down: '#e46876', good: '#98bb6c', warn: '#e6c384', bad: '#ff5d62', switchOn: '#98bb6c',
      focus: '0 0 0 3px rgb(126 156 216 / 0.45)',
    },
    chart: {
      background: '#1f1f28', backgroundGradient: '#1b2535', text: '#c8c093', grid: '#2a2a37', border: '#363646', up: '#98bb6c',
      down: '#e46876', line: '#7e9cd8', crosshair: '#727169', askLine: '#e46876',
      palette: ['#7e9cd8', '#ffa066', '#d27e99', '#7aa89f', '#957fb8', '#98bb6c', '#e6c384'],
    },
  },
  {
    id: 'github-dark-dimmed',
    label: 'GitHub Dark Dimmed',
    mode: 'dark',
    ui: {
      chrome: '#1c2128', chromeBlur: 'rgb(28 33 40 / 0.84)', surface: '#22272e', surfaceAlt: '#272d35', surfaceRaised: '#2d333b',
      border: 'rgb(173 186 199 / 0.15)', borderSoft: 'rgb(173 186 199 / 0.08)', text: '#adbac7', muted: '#8b98a5', accent: '#539bf5',
      accentText: '#1c2128', accentSoft: 'rgb(83 155 245 / 0.2)', selection: 'rgb(83 155 245 / 0.28)',
      hover: 'rgb(173 186 199 / 0.06)', buy: '#539bf5', sell: '#e7625b', profit: '#57ab5a', loss: '#e7625b', up: '#57ab5a',
      down: '#e7625b', good: '#57ab5a', warn: '#c69026', bad: '#e5534b', switchOn: '#57ab5a',
      focus: '0 0 0 3px rgb(83 155 245 / 0.45)',
    },
    chart: {
      background: '#22272e', text: '#909dab', grid: '#2a3038', border: '#373e47', up: '#57ab5a', down: '#e5534b', line: '#539bf5',
      crosshair: '#636e7b', askLine: '#e5534b',
      palette: ['#539bf5', '#e0823d', '#e275ad', '#56d4dd', '#986ee2', '#57ab5a', '#c69026'],
    },
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    mode: 'light',
    ui: {
      chrome: '#e6e9ef', chromeBlur: 'rgb(230 233 239 / 0.8)', surface: '#eff1f5', surfaceAlt: '#e9ecf2', surfaceRaised: '#f7f8fa',
      border: 'rgb(76 79 105 / 0.14)', borderSoft: 'rgb(76 79 105 / 0.07)', text: '#4c4f69', muted: '#6a6d82', accent: '#8839ef',
      accentText: '#ffffff', accentSoft: 'rgb(136 57 239 / 0.12)', selection: 'rgb(136 57 239 / 0.16)', hover: 'rgb(76 79 105 / 0.05)',
      buy: '#1d63ee', sell: '#d20f39', profit: '#327d22', loss: '#d20f39', up: '#327d22', down: '#d20f39', good: '#327d22',
      warn: '#986114', bad: '#d20f39', switchOn: '#40a02b',
      focus: '0 0 0 3px rgb(136 57 239 / 0.3)',
    },
    chart: {
      background: '#eff1f5', text: '#5c5f77', grid: '#e4e7ee', border: '#ccd0da', up: '#3d9a29', down: '#d20f39', line: '#1e66f5',
      crosshair: '#8c8fa1', askLine: '#d20f39',
      palette: ['#1e66f5', '#fe640b', '#ea76cb', '#04a5e5', '#8839ef', '#40a02b', '#df8e1d'],
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    mode: 'light',
    ui: {
      chrome: '#eee8d5', chromeBlur: 'rgb(238 232 213 / 0.8)', surface: '#fdf6e3', surfaceAlt: '#f6efdb', surfaceRaised: '#fffbf0',
      border: 'rgb(7 54 66 / 0.14)', borderSoft: 'rgb(7 54 66 / 0.07)', text: '#073642', muted: '#586e75', accent: '#2076b3',
      accentText: '#ffffff', accentSoft: 'rgb(32 118 179 / 0.12)', selection: 'rgb(32 118 179 / 0.16)', hover: 'rgb(7 54 66 / 0.05)',
      buy: '#2076b3', sell: '#d5312e', profit: '#687700', loss: '#d5312e', up: '#687700', down: '#d5312e', good: '#687700',
      warn: '#8f6c00', bad: '#dc322f', switchOn: '#2aa198',
      focus: '0 0 0 3px rgb(32 118 179 / 0.3)',
    },
    chart: {
      background: '#fdf6e3', text: '#586e75', grid: '#f1ead6', border: '#e4dcc5', up: '#7f9200', down: '#dc322f', line: '#268bd2',
      crosshair: '#93a1a1', askLine: '#dc322f',
      palette: ['#268bd2', '#cb4b16', '#d33682', '#2aa198', '#6c71c4', '#859900', '#b58900'],
    },
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rosé Pine Dawn',
    mode: 'light',
    ui: {
      chrome: '#f2e9e1', chromeBlur: 'rgb(242 233 225 / 0.8)', surface: '#fffaf3', surfaceAlt: '#faf4ed', surfaceRaised: '#ffffff',
      border: 'rgb(87 82 121 / 0.14)', borderSoft: 'rgb(87 82 121 / 0.07)', text: '#575279', muted: '#74708d', accent: '#286983',
      accentText: '#ffffff', accentSoft: 'rgb(40 105 131 / 0.12)', selection: 'rgb(40 105 131 / 0.16)', hover: 'rgb(87 82 121 / 0.05)',
      buy: '#286983', sell: '#a75c71', profit: '#286983', loss: '#a75c71', up: '#286983', down: '#a75c71', good: '#286983',
      warn: '#9d6923', bad: '#b4637a', switchOn: '#56949f',
      focus: '0 0 0 3px rgb(40 105 131 / 0.3)',
    },
    chart: {
      background: '#faf4ed', text: '#716d89', grid: '#f2e9e1', border: '#dfdad9', up: '#56949f', down: '#b4637a', line: '#907aa9',
      crosshair: '#9893a5', askLine: '#b4637a',
      palette: ['#286983', '#ea9d34', '#d7827e', '#56949f', '#907aa9', '#797593', '#575279'],
    },
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    mode: 'light',
    ui: {
      chrome: '#f6f8fa', chromeBlur: 'rgb(246 248 250 / 0.8)', surface: '#ffffff', surfaceAlt: '#f6f8fa', surfaceRaised: '#ffffff',
      border: 'rgb(31 35 40 / 0.14)', borderSoft: 'rgb(31 35 40 / 0.07)', text: '#1f2328', muted: '#59636e', accent: '#0969da',
      accentText: '#ffffff', accentSoft: 'rgb(9 105 218 / 0.12)', selection: 'rgb(9 105 218 / 0.16)', hover: 'rgb(31 35 40 / 0.05)',
      buy: '#0969da', sell: '#cf222e', profit: '#1a7f37', loss: '#cf222e', up: '#1a7f37', down: '#cf222e', good: '#1a7f37',
      warn: '#9a6700', bad: '#d1242f', switchOn: '#1f883d',
      focus: '0 0 0 3px rgb(9 105 218 / 0.3)',
    },
    chart: {
      background: '#ffffff', text: '#59636e', grid: '#f3f4f6', border: '#d1d9e0', up: '#1a7f37', down: '#cf222e', line: '#0969da',
      crosshair: '#818b98', askLine: '#cf222e',
      palette: ['#0969da', '#bc4c00', '#bf3989', '#1b7c83', '#8250df', '#1a7f37', '#9a6700'],
    },
  },
  {
    id: 'chart-classic',
    label: 'Classic',
    mode: 'dark',
    isChartOnly: true,
    ui: {
      buy: '#2962ff', sell: '#f23645', profit: '#089981', loss: '#f23645', up: '#089981', down: '#f23645',
    },
    chart: {
      background: '#131722', text: '#b2b5be', grid: '#1e222d', border: '#2a2e39', up: '#089981', down: '#f23645', line: '#2962ff',
      crosshair: '#758696', askLine: '#f23645',
    },
  },
  {
    id: 'chart-aurora',
    label: 'Aurora',
    mode: 'dark',
    isChartOnly: true,
    ui: {
      buy: '#7c9cff', sell: '#ff5c8a', profit: '#2ee6a6', loss: '#ff5c8a', up: '#2ee6a6', down: '#ff5c8a',
    },
    chart: {
      background: '#0a0f1f', backgroundGradient: '#10263b', text: '#9fb0cc', grid: '#151f37', border: '#1e2a47', up: '#2ee6a6',
      down: '#ff5c8a', line: '#7c9cff', crosshair: '#5a6a8c', askLine: '#ff5c8a',
      palette: ['#7c9cff', '#ffb454', '#ff7ad9', '#4fd8ff', '#b58cff', '#2ee6a6', '#ffe66d'],
    },
  },
  {
    id: 'chart-amber',
    label: 'Amber Terminal',
    mode: 'dark',
    isChartOnly: true,
    ui: {
      buy: '#5ab4ff', sell: '#ff4b3e', profit: '#3fd8a5', loss: '#ff4b3e', up: '#3fd8a5', down: '#ff4b3e',
    },
    chart: {
      background: '#000000', text: '#ffa028', grid: '#1a1308', border: '#3a2b10', up: '#3fd8a5', down: '#ff4b3e', line: '#ffa028',
      crosshair: '#806030', askLine: '#ff4b3e',
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      palette: ['#ffa028', '#5ab4ff', '#ff6ec7', '#3fd8a5', '#c08cff', '#e8e8e8', '#ffe14d'],
    },
  },
  {
    id: 'chart-colour-safe',
    label: 'Colour-blind Safe',
    mode: 'dark',
    isChartOnly: true,
    ui: {
      buy: '#3d8bff', sell: '#ff9f1a', profit: '#3d8bff', loss: '#ff9f1a', up: '#3d8bff', down: '#ff9f1a',
    },
    chart: {
      background: '#16181d', text: '#b0b6c2', grid: '#20232a', border: '#2c3038', up: '#3d8bff', down: '#ff9f1a', line: '#c8ccd4',
      crosshair: '#7a808c', askLine: '#ff9f1a',
      palette: ['#56b4e9', '#e69f00', '#cc79a7', '#009e73', '#f0e442', '#0072b2', '#d55e00'],
    },
  },
  {
    id: 'chart-ink',
    label: 'Ink',
    mode: 'light',
    isChartOnly: true,
    ui: {
      buy: '#1c1c1c', sell: '#5c5c5c', profit: '#2e2e2e', loss: '#6a6a6a', up: '#4a4a4a', down: '#1c1c1c',
    },
    chart: {
      background: '#fbfbf9', text: '#3c3c3c', grid: '#efefec', border: '#d9d9d4', up: '#8f8f8b', down: '#1c1c1c', line: '#1c1c1c',
      crosshair: '#8a8a86', askLine: '#1c1c1c',
      palette: ['#1c1c1c', '#6b6b6b', '#9a9a9a', '#444444', '#808080', '#2f2f2f', '#b5b5b5'],
    },
  },
  {
    id: 'chart-daylight',
    label: 'Daylight',
    mode: 'light',
    isChartOnly: true,
    ui: {
      buy: '#0052cc', sell: '#de350b', profit: '#00875a', loss: '#de350b', up: '#00875a', down: '#de350b',
    },
    chart: {
      background: '#ffffff', text: '#172b4d', grid: '#eef1f5', border: '#c9d1dc', up: '#00875a', down: '#de350b', line: '#0052cc',
      crosshair: '#6b778c', askLine: '#de350b',
      palette: ['#0052cc', '#ff8b00', '#c9379d', '#00a3bf', '#6554c0', '#36b37e', '#ffab00'],
    },
  },
  {
    id: 'chart-high-contrast',
    label: 'High Contrast',
    mode: 'dark',
    isChartOnly: true,
    ui: {
      buy: '#40c4ff', sell: '#ff4060', profit: '#00e676', loss: '#ff4060', up: '#00e676', down: '#ff4060',
    },
    chart: {
      background: '#000000', text: '#ffffff', grid: '#1f1f1f', border: '#4d4d4d', up: '#00e676', down: '#ff4060', line: '#ffffff',
      crosshair: '#bdbdbd', askLine: '#ff4060',
      palette: ['#40c4ff', '#ffab40', '#ff4081', '#64ffda', '#e040fb', '#eeff41', '#ffffff'],
    },
  },
];
