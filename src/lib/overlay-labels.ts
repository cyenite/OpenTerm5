export interface LabelSlot {
  id: string;
  y: number;
  lane: string;
}

// Moves labels in the same lane apart so none overlaps another, keeping each as close to its line
// as it can and inside 0..height. Returns each label's offset from its line.
export function spreadLabels(slots: readonly LabelSlot[], gap: number, height: number): Map<string, number> {
  const offsets = new Map<string, number>();
  const lanes = new Map<string, LabelSlot[]>();
  for (const slot of slots) lanes.set(slot.lane, [...(lanes.get(slot.lane) ?? []), slot]);
  for (const lane of lanes.values()) {
    const sorted = [...lane].sort((left, right) => left.y - right.y || left.id.localeCompare(right.id));
    const centres = sorted.map((slot) => slot.y);
    for (let index = 1; index < centres.length; index++) centres[index] = Math.max(centres[index], centres[index - 1] + gap);
    // A stack pushed past the bottom moves back up, as a block, as far as the top allows.
    const overflow = centres.length ? centres[centres.length - 1] - (height - gap / 2) : 0;
    if (overflow > 0) {
      centres[centres.length - 1] -= overflow;
      for (let index = centres.length - 2; index >= 0; index--) centres[index] = Math.min(centres[index], centres[index + 1] - gap);
      for (let index = 0; index < centres.length; index++) centres[index] = Math.max(centres[index], gap / 2 + index * gap);
    }
    sorted.forEach((slot, index) => offsets.set(slot.id, Math.round(centres[index] - slot.y)));
  }
  return offsets;
}
