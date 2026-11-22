// The catalogue has no plain 'back' tag; the Back chip spans these two (#701).
export function muscleFilterTags(chip) {
  if (chip === 'back') return ['middle back', 'lower back'];
  return [chip];
}
