import type { StudyObjects, StudyOutput } from '../types';

const nulls = <T>(count: number): (T | null)[] => new Array<T | null>(count).fill(null);

const prepended = <T>(values: readonly (T | null)[] | undefined, count: number): (T | null)[] | undefined => (values ? [...nulls<T>(count), ...values] : undefined);

function shiftObjects(objects: StudyObjects, count: number): StudyObjects {
  return {
    lines: objects.lines.map((line) => ({ ...line, startIndex: line.startIndex + count, endIndex: line.endIndex + count })),
    boxes: objects.boxes.map((box) => ({ ...box, leftIndex: box.leftIndex + count, rightIndex: box.rightIndex + count })),
    labels: objects.labels.map((label) => ({ ...label, index: label.index + count })),
    tables: objects.tables,
    polylines: objects.polylines.map((polyline) => ({ ...polyline, points: polyline.points.map((point) => ({ ...point, index: point.index + count })) })),
  };
}

// The output realigned after `count` older bars were put in front of the bars it was computed
// on, so a study computed elsewhere stays in place until its next result arrives.
export function shiftOutput(output: StudyOutput, count: number): StudyOutput {
  if (count <= 0) return output;
  return {
    plots: output.plots.map((plot) => ({ ...plot, values: prepended(plot.values, count)!, colors: prepended(plot.colors, count) })),
    ...(output.bands ? { bands: output.bands.map((band) => ({ ...band, colors: prepended(band.colors, count), gradients: prepended(band.gradients, count) })) } : {}),
    ...(output.levels ? { levels: output.levels } : {}),
    ...(output.markers ? { markers: output.markers.map((marker) => ({ ...marker, index: marker.index + count })) } : {}),
    ...(output.barColors ? { barColors: prepended(output.barColors, count) } : {}),
    ...(output.backgrounds ? { backgrounds: prepended(output.backgrounds, count) } : {}),
    ...(output.objects ? { objects: shiftObjects(output.objects, count) } : {}),
  };
}
