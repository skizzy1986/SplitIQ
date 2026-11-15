---
category: Navigation
---

# BottomTabBar

The mobile bottom navigation. Four fixed tabs — Today, Train, Progress, Body, from
`constants/destinations.js` — each an emoji glyph over a small tracked caption. The
tab list is internal to the component; it is not configurable by props.

The active tab's caption switches to `THEME.accent`; inactive tabs stay muted.
The bar is `position: fixed` to the bottom of the viewport at `z-index: 100`,
64px tall (`TAB_BAR_HEIGHT`), and pads itself with `env(safe-area-inset-bottom)` for notched
devices — so page content underneath needs its own bottom padding to clear it.

```jsx
<BottomTabBar activeTab="today" onTabChange={setTab} />
```
