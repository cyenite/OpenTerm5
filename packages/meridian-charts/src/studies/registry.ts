import type { InputValue, StudyDefinition } from '../types';
import { builtinStudies } from './builtin';
import { extendedStudies } from './extended';

export interface StudyInfo {
  type: string;
  title: string;
  shortTitle?: string;
  overlay: boolean;
}

const registry = new Map<string, StudyDefinition>([...builtinStudies, ...extendedStudies].map((study) => [study.type, study]));

// Registers a study computed by the host. It then appears in the catalogue and behaves like a
// built-in one: legend row, settings dialog, saved with the chart. The returned function removes
// it again, unless another definition has replaced it under the same type since.
export function defineIndicator(definition: StudyDefinition): () => void {
  registry.set(definition.type, definition);
  return () => {
    if (registry.get(definition.type) === definition) registry.delete(definition.type);
  };
}

export function getStudy(type: string): StudyDefinition | undefined {
  return registry.get(type);
}

export function indicatorCatalogue(): StudyInfo[] {
  return [...registry.values()].map((study) => ({ type: study.type, title: study.title, ...(study.shortTitle ? { shortTitle: study.shortTitle } : {}), overlay: study.overlay }));
}

// The study's inputs with every missing or mistyped value replaced by its default.
export function resolveInputs(study: StudyDefinition, values: Record<string, InputValue> = {}): Record<string, InputValue> {
  return Object.fromEntries(study.inputs.map((input) => {
    const value = values[input.key];
    const isNumber = input.type === 'int' || input.type === 'float' || input.type === 'time';
    const isValid = input.type === 'bool' ? typeof value === 'boolean' : isNumber ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'string';
    return [input.key, isValid ? value : input.default];
  }));
}

// "RSI 14 Close": the short title and the numeric and text inputs, as legends show it.
export function studyCaption(study: StudyDefinition, inputs: Record<string, InputValue>): string {
  // Times and long text would crowd the legend out.
  const isCaptioned = (input: StudyDefinition['inputs'][number]) => !input.isCaptionHidden && input.type !== 'bool' && input.type !== 'color' && input.type !== 'time' && !(input.type === 'text' && String(inputs[input.key]).length > 24);
  const values = study.inputs.filter(isCaptioned).map((input) => inputs[input.key]);
  return [study.shortTitle ?? study.title, ...values].join(' ');
}
