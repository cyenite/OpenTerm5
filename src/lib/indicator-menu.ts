import { indicatorCatalogue, type StudyInfo } from '@meridian/charts';
import type { MenuItem } from '../components/MenuBar';
import { mt5StudyPrefix } from './mt5-studies';
import { addIndicator } from './workspace';

export interface StudyGroup {
  label: string;
  studies: StudyInfo[];
}

// MetaTrader's formulas first, as an MT5 user expects them, then the rest of Meridian's catalogue:
// studies drawn over price, then those in a pane of their own.
export function studyGroups(): StudyGroup[] {
  const studies = indicatorCatalogue().sort((left, right) => left.title.localeCompare(right.title));
  const meridian = studies.filter((study) => !study.type.startsWith(mt5StudyPrefix));
  return [
    { label: 'MetaTrader 5', studies: studies.filter((study) => study.type.startsWith(mt5StudyPrefix)).map((study) => ({ ...study, title: study.title.replace(/ \(MT5\)$/, '') })) },
    { label: 'Trend & Overlays', studies: meridian.filter((study) => study.overlay) },
    { label: 'Oscillators & Volume', studies: meridian.filter((study) => !study.overlay) },
  ];
}

export function studyTitle(kind: string): string {
  return indicatorCatalogue().find((study) => study.type === kind)?.title ?? kind;
}

export function indicatorMenuItems(chartId: string | undefined): MenuItem[] {
  return studyGroups().map((group) => ({
    label: group.label,
    isDisabled: !chartId,
    items: group.studies.map((study) => ({ label: study.title, action: () => chartId && addIndicator(chartId, study.type) })),
  }));
}
