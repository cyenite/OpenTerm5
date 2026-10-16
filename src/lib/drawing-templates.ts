import type { DrawingTemplate, DrawingTemplateStore } from '@meridian/charts';
import { migrateDrawing } from './chart-model';
import { log } from './session';
import { Store } from './store';

// Named settings for each drawing tool (a "BOS" trend line, an "FVG" rectangle), applied from a
// drawing's Template menu on any chart, and imported from TradingView.

export interface DrawingTemplatesState {
  byType: Readonly<Record<string, readonly DrawingTemplate[]>>;
  // The look each tool's next drawing starts with: the last one restyled or templated.
  lastByType: Readonly<Record<string, DrawingTemplate>>;
}

const STORAGE_KEY = 'openterm.drawing-templates.v1';
const LOOKS_KEY = 'openterm.drawing-looks.v1';

// Templates from storage, read through the drawing migration so their styles get the same checks.
export function restoreDrawingTemplates(value: unknown): Record<string, DrawingTemplate[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([type, list]) => {
    const templates = (Array.isArray(list) ? list : []).flatMap((item): DrawingTemplate[] => {
      if (item === null || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) return [];
      const drawing = migrateDrawing({ id: 'template', type, anchors: [{ time: 0, price: 0 }], style: item.style, props: item.props, text: item.text });
      if (!drawing) return [];
      return [{ name: item.name, style: drawing.style, ...(drawing.props ? { props: drawing.props } : {}), ...(drawing.text !== undefined ? { text: drawing.text } : {}) }];
    });
    return templates.length ? [[type, templates]] : [];
  }));
}

// The last-used looks, stored as one unnamed template per tool and checked the same way.
export function restoreDrawingLooks(value: unknown): Record<string, DrawingTemplate> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const named = Object.fromEntries(Object.entries(value).map(([type, look]) => [type, [{ ...(look as object), name: 'look' }]]));
  return Object.fromEntries(Object.entries(restoreDrawingTemplates(named)).map(([type, [look]]) => [type, { ...look, name: '' }]));
}

function load<T>(key: string, restore: (value: unknown) => T, fallback: T): T {
  try {
    return restore(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return fallback;
  }
}

export const drawingTemplates = new Store<DrawingTemplatesState>({ byType: load(STORAGE_KEY, restoreDrawingTemplates, {}), lastByType: load(LOOKS_KEY, restoreDrawingLooks, {}) });

const none: readonly DrawingTemplate[] = [];

function saveTemplate(type: string, template: DrawingTemplate): void {
  drawingTemplates.set((state) => {
    const list = (state.byType[type] ?? none).filter((candidate) => candidate.name !== template.name);
    return { byType: { ...state.byType, [type]: [...list, template].sort((left, right) => left.name.localeCompare(right.name)) } };
  });
}

function removeTemplate(type: string, name: string): void {
  drawingTemplates.set((state) => {
    const list = (state.byType[type] ?? none).filter((candidate) => candidate.name !== name);
    const byType = Object.fromEntries(Object.entries(state.byType).filter(([candidate]) => candidate !== type));
    return { byType: list.length ? { ...byType, [type]: list } : byType };
  });
}

// What every chart is given: the templates live here, so a template saved on one chart is offered on all.
export const drawingTemplateStore: DrawingTemplateStore = {
  list: (type) => drawingTemplates.get().byType[type] ?? none,
  save: saveTemplate,
  remove: removeTemplate,
  lastUsed: (type) => drawingTemplates.get().lastByType[type],
  setLastUsed: (type, template) => drawingTemplates.set((state) => ({ lastByType: { ...state.lastByType, [type]: template } })),
};

// Adds imported templates. One with the name of a template already here is kept as it is unless
// `isReplacing`; returns how many were added and how many kept.
export function addDrawingTemplates(entries: readonly { type: string; template: DrawingTemplate }[], isReplacing: boolean): { added: number; kept: number } {
  let added = 0;
  let kept = 0;
  for (const { type, template } of entries) {
    const exists = drawingTemplateStore.list(type).some((candidate) => candidate.name === template.name);
    if (exists && !isReplacing) { kept++; continue; }
    saveTemplate(type, template);
    added++;
  }
  return { added, kept };
}

export function startDrawingTemplates(): void {
  let isSaveFailing = false;
  drawingTemplates.subscribe(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawingTemplates.get().byType));
      localStorage.setItem(LOOKS_KEY, JSON.stringify(drawingTemplates.get().lastByType));
      isSaveFailing = false;
    } catch (error) {
      if (!isSaveFailing) log(`Drawing templates could not be saved: ${(error as Error).message}`, 'Charts');
      isSaveFailing = true;
    }
  });
}
