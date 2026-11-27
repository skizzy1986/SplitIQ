import {
  MARK_S_PATH,
  MARK_SIZE,
  MARK_STROKE_WIDTH,
  MARK_TILE_PATH,
  MARK_VIEWBOX,
  WORDMARK_HEIGHT,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
  WORDMARK_WIDTH,
} from '../constants/markPaths.js';

// The SplitIQ mark and wordmark as SVG strings, in the colours the caller
// passes. Pure: no DOM, no theme lookup. A texture cannot resolve a
// var(--color-*) pointer, so #761 passes resolved palette values
// (DARK / LIGHT from constants/themeValues.js) and redraws on a theme change.
//
// A colour is written straight into an attribute, so it is checked first: a hex
// value or a --color-* pointer, nothing else. Anything looser would let a
// string close the attribute and add markup to an image that ends up in a
// data: URL.
const COLOUR =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|var\(--color-[a-z0-9-]+\))$/i;

function colour(name, value) {
  if (typeof value !== 'string' || !COLOUR.test(value)) {
    throw new TypeError(
      `${name} must be a hex colour or a var(--color-*) pointer, got ${String(value)}`
    );
  }
  return value;
}

function sizeAttrs(width, height, size) {
  if (size === undefined) return '';
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`size must be a positive number, got ${String(size)}`);
  }
  // The width follows the mark's own aspect, so one number sizes both shapes.
  const w = +size.toFixed(2);
  const h = +((size * height) / width).toFixed(2);
  return ` width="${w}" height="${h}"`;
}

/**
 * The "S" in its rounded square.
 *
 * @param {object} o
 * @param {string} o.ink     the S and the square's stroke
 * @param {string|null} [o.ground]  a square behind it, edge to edge; omitted
 *   or null leaves the background transparent
 * @param {number} [o.size]  pixel width and height; omitted, the SVG scales to
 *   its container
 * @returns {string}
 */
export function markSvg({ ink, ground = null, size } = {}) {
  const fg = colour('ink', ink);
  const bg = ground === null ? null : colour('ground', ground);
  const back = bg
    ? `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${bg}"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"` +
    `${sizeAttrs(MARK_SIZE, MARK_SIZE, size)}>` +
    back +
    `<path d="${MARK_TILE_PATH}" fill="none" stroke="${fg}" stroke-width="${MARK_STROKE_WIDTH}"/>` +
    `<path d="${MARK_S_PATH}" fill="${fg}"/>` +
    '</svg>'
  );
}

/**
 * The SPLITIQ wordmark: bold caps, tracked 0.125 em.
 *
 * @param {object} o
 * @param {string} o.ink
 * @param {number} [o.size]  pixel width; the height follows
 * @returns {string}
 */
export function wordmarkSvg({ ink, size } = {}) {
  const fg = colour('ink', ink);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK_VIEWBOX}"` +
    `${sizeAttrs(WORDMARK_WIDTH, WORDMARK_HEIGHT, size)}>` +
    `<path d="${WORDMARK_PATH}" fill="${fg}"/>` +
    '</svg>'
  );
}
