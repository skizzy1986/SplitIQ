---
category: Tooltips
---

# LoadTooltip

Recharts tooltip for the training-load chart — the CTL / ATL / TSB stack.

CTL is labelled `accent`, ATL `warning`, and **TSB is colour-coded by value**:
`positive` above +10, `caution` down to -10, `warning` down to -30, `critical`
below that. TSB is printed
with an explicit `+` when positive. A TSS row is appended below a divider only
when that day actually carried load (`tss > 0`), and an optional `note` is
appended to the date eyebrow.

```jsx
<Tooltip content={<LoadTooltip />} />
```
