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
// built-in one: legend row, settings dialog, saved with the chart.
export function defineIndicator(definition: StudyDefinition): void {
  registry.set(definition.type, definition);
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
    const isValid = input.type === 'bool' ? typeof value === 'boolean' : input.type === 'int' || input.type === 'float' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'string';
    return [input.key, isValid ? value : input.default];
  }));
}

// "RSI 14 Close": the short title and the numeric and text inputs, as legends show it.
export function studyCaption(study: StudyDefinition, inputs: Record<string, InputValue>): string {
  const values = study.inputs.filter((input) => input.type !== 'bool' && input.type !== 'color').map((input) => inputs[input.key]);
  return [study.shortTitle ?? study.title, ...values].join(' ');
}
