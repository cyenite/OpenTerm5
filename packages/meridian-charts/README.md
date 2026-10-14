# Meridian charts

The chart engine and theme system shared by Meridian and OpenTerm5. It has no runtime
dependencies: charts are drawn on a canvas, and the toolbar, legend and dialogs are plain DOM.

- **`MeridianChart`** (`chart.ts`): a chart fed by a `DataProvider` the host implements
  (`getBars`, optional `subscribe` and `getSymbolInfo`). Candles, bars, line, area, baseline and
  Heikin Ashi; studies on the price pane or in panes of their own; volume; crosshair; price and time
  axes with dragging; history paging; live bars; host price lines with labels; and projection
  (`priceToY`, `yToPrice`, `plotBox`) for HTML overlays such as draggable order lines.
- **Editing**: undo and redo (`undo`, `redo`, `onHistoryChange`, `clearHistory`) of drawings and
  studies, a clipboard shared by the charts in a window, in-place text editing, and context menus
  for drawings, the price axis and the chart. `onContextMenu` lets the host replace the chart's own
  menu for the plot area.
- **Settings** (`settings.ts`): `ChartSettings` for colours, status line, scales and appearance,
  edited in the Chart Settings dialog (`openChartSettings`), read and written with `settings`,
  `setSettings` and `onSettingsChange`, and validated with `restoreSettings`. Price scales
  (`core/price-scale.ts`) can be regular, logarithmic, percent or indexed, and inverted.
- **Analysis**: an object tree (`toggleObjectTree`), bar replay (`startReplay`, `exitReplay`), a
  symbol watermark, and `setCrosshairTime` for crosshairs linked across charts.
- **Timeframes** (`core/timeframes.ts`): seconds (`'5s'`), minutes (`'15'`), hours (`'4h'`), days,
  weeks and months (`'1D'`, `'1W'`, `'1M'`).
- **Studies** (`studies/`): 86 built-in studies (`builtin.ts` and `extended.ts`, maths in `math.ts`). `defineIndicator`
  registers a study the host computes, which then behaves like a built-in one.
- **Drawings** (`drawings/`): 82 tools in six groups (`catalogue.ts`). Each tool describes itself as
  shapes (`shapes.ts`) that are both painted and hit-tested (`tools.ts`), and declares its own
  settings (levels, options) as `fields`. The chart handles placing, selecting, moving, anchor
  editing, the magnet, locking, hiding and the tabbed settings dialog (`drawings/settings.ts`).
- **Toolbar** (`ui/toolbar.ts`): groups with sectioned flyouts, last-used tool per group, favourites,
  magnet, stay-in-drawing-mode, lock, hide and remove. Icons are in `ui/icons.ts`.
- **Themes** (`themes.ts`): one palette colours both the host application, through CSS custom
  properties, and the charts. `listThemes`, `getTheme`, `resolveTheme` (with `"system"` following
  the operating system), `createTheme`, `registerTheme` and `applyTheme`.

The package lives in the OpenTerm5 repository and is imported as `@meridian/charts` through a path
alias; it has no build step of its own. Run its tests with `npm test` from the repository root.
