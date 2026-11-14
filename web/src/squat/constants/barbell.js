// The barbell the squat is lifted with, in metres, handed to the 3D scene
// through movements/squat/movement.js (equipment.bar). Its colour is not here:
// that is the anatomyBar palette token, so it follows the theme. Its offset
// from the frame (meta.bar.c) and the shaft radius the data was extracted with
// (meta.bar.r, which wins over `radius`) stay in the manifest.
export const BARBELL = Object.freeze({
  // The pose frame the bar rides on.
  frame: 'thorax',
  radius: 0.0145,
  length: 2.2,
  plateRadius: 0.225,
  plateWidth: 0.06,
  plateOffset: 0.8,
  sleeveRadius: 0.025,
  sleeveLength: 0.42,
  // Facets around each cylinder (shaft, sleeves, plates).
  segments: 24,
  metalness: 0.6,
  roughness: 0.35,
});
