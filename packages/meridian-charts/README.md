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
- **Analysis**: an object tree (`toggleObjectTree`), bar replay (below), a symbol watermark, and
  linked charts for multi-chart layouts: `setExternalCrosshair` mirrors another chart's crosshair,
  `onTimeClick` and `scrollToTime` follow a clicked time, and `visibleRange`,
  `onVisibleRangeChange` and `setVisibleRange` share a date range.
- **Bar replay** (`core/replay.ts`): a replay runs on a time T (epoch ms) and shows only data that
  ended by T. A bar ends where the next one opens, capped at its interval, so the last bar before a
  weekend ends at the close. The bar in progress at T is built from detail bars at a finer step
  timeframe that have ended by T, and is left out when no such detail is loaded or available.
  - Standalone (the default): `startReplay` waits for a click on the start bar, then the chart's own
    controls step and play in whole bars; `exitReplay` leaves.
  - Hosted (`setReplayHosted(true)`), for several charts replayed on one clock: the chart shows no
    controls, and its replay menu item and Escape during start selection call `onReplayRequest`
    listeners with `'start'`, `'exit'` or `'cancel'` instead of acting (as do `startReplay` and
    `exitReplay`). The host calls `selectReplayStart`; a click then fires `onReplayPick` with the
    end of the clicked bar, and the host sets the time on every chart with
    `setReplay({ time, step })` (`step` is a timeframe such as `'15'`, or null for whole bars) and
    leaves with `setReplay(null)`. `cancelReplaySelection` ends a selection, and the replay too when
    no time is set yet; `setReplay` does not end a selection. Shift+Right and Shift+Down are left to
    the host while a hosted replay runs.
  - `nextReplayTime(after)` gives the next time a bar ends at the chart's step (whole bars where
    the detail is not loaded), so a host steps all charts to the earliest of these; null at the end
    of the data. `earliestReplayTime` is the end of the first loaded bar, and `replayTime`,
    `isReplaying`, `isReplaySelecting` and `onReplayChange` report the state.
  - Detail bars are fetched as needed, from the opening of the bar in progress to a few hundred
    steps ahead. Paging older history is off during a replay, live bars wait until it ends, and a
    `setMarket` ends it; `setReplay` once `setMarket` resolves applies the time to the new series.
- **Timeframes** (`core/timeframes.ts`): seconds (`'5s'`), minutes (`'15'`), hours (`'4h'`), days,
  weeks and months (`'1D'`, `'1W'`, `'1M'`).
- **Studies** (`studies/`): 86 built-in studies (`builtin.ts` and `extended.ts`, maths in `math.ts`). `defineIndicator`
  registers a study the host computes, which then behaves like a built-in one.
- **Drawings** (`drawings/`): 82 tools in six groups (`catalogue.ts`). Each tool describes itself as
  shapes (`shapes.ts`) that are both painted and hit-tested (`tools.ts`), and declares its own
  settings (levels, options) as `fields`. The chart handles placing, selecting, moving, anchor
  editing, the magnet, locking, hiding and the settings dialog (`drawings/settings.ts`), laid out
  like TradingView's with a live preview, interval-range visibility and a Template menu. A new
  drawing starts with the last look the user gave its tool (`DrawingTemplateStore.lastUsed`).
- **Dialogs and popups** (`ui/dialog.ts`, `ui/color-picker.ts`, `ui/dropdown.ts`, `ui/stylebar.ts`):
  the property dialog, TradingView's colour picker (palette, custom colours, opacity, thickness),
  list dropdowns, and the floating toolbar of the selected drawing.
- **Toolbar** (`ui/toolbar.ts`): groups with sectioned flyouts, last-used tool per group, favourites,
  magnet, stay-in-drawing-mode, lock, hide and remove. Icons are in `ui/icons.ts`. A host with several
  charts can mount one `DrawingToolbar` for all of them, as TradingView does: give it
  `meridianUiVariables(theme)` on its overlay element, keep the choices in step with
  `drawingTools()`/`setDrawingTools()`/`onDrawingToolsChange()` on each chart (changes made by
  `setDrawingTools` are not echoed back), and send remove actions to the active chart's
  `removeAllDrawings()`/`removeAllStudies()`. Favourites are shared through `drawingFavorites()` and
  `saveDrawingFavorites()`.
- **Themes** (`themes.ts`): one palette colours both the host application, through CSS custom
  properties, and the charts. `listThemes`, `getTheme`, `resolveTheme` (with `"system"` following
  the operating system), `createTheme`, `registerTheme` and `applyTheme`.

The package lives in the OpenTerm5 repository and is imported as `@meridian/charts` through a path
alias; it has no build step of its own. Run its tests with `npm test` from the repository root.
