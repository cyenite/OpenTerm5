import type { SerializedDrawing } from '../types';

// Replays a host's change to the drawings onto a saved undo or redo state. The host's change is not
// one of this chart's edits, so undoing an earlier edit must neither bring back what the host
// removed nor drop what it added or changed.
export function rebaseDrawings(saved: readonly SerializedDrawing[], previous: readonly SerializedDrawing[], next: readonly SerializedDrawing[]): SerializedDrawing[] {
  const before = new Map(previous.map((drawing) => [drawing.id, JSON.stringify(drawing)]));
  const kept = new Set(next.map((drawing) => drawing.id));
  const changed = next.filter((drawing) => !drawing.props?.isTransient && before.get(drawing.id) !== JSON.stringify(drawing));
  const touched = new Set([...changed.map((drawing) => drawing.id), ...previous.filter((drawing) => !kept.has(drawing.id)).map((drawing) => drawing.id)]);
  return [...saved.filter((drawing) => !touched.has(drawing.id)), ...structuredClone(changed)];
}
