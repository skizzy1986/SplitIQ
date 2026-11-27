// Test-only. The rendered text of an element with a space between every text
// node. `textContent` joins them with nothing, so "Today" beside "CP
// unavailable" reads "TodayCP unavailable" and a /\bCP\b/ check misses it
// (#819 slice S2, Gate 3). Use this for every "names no CP" assertion.
export function spacedText(root) {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const parts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t) parts.push(t);
  }
  return parts.join(' ');
}
