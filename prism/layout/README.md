# Prism Layouts

A layout controls the **structural arrangement** of Prism's panels — where the sidebar lives, how wide it is, how the main content area and split-panels are sized and positioned. All visual styling (colors, fonts) comes from the active theme and is unaffected by layout changes.

## How to switch layouts

In `prism/index.html`, find this tag near the top of `<head>`:

```html
<link id="prism-layout" rel="stylesheet" href="layout/default.css">
```

Change `href` to point to a different layout file:

```html
<link id="prism-layout" rel="stylesheet" href="layout/wide-sidebar.css">
```

## How to create a new layout

1. Copy `default.css` to a new file (e.g., `wide-sidebar.css`)
2. Adjust the structural rules — sidebar width, content padding, panel dimensions
3. Update the `<link id="prism-layout">` tag in `index.html`

## Key structural elements

| Selector | What it controls |
|---|---|
| `#sidebar` | Left navigation panel — width, position, scroll |
| `.sidebar-logo` | Logo / branding block at top of sidebar |
| `.sidebar-section` | Nav group container within sidebar |
| `.nav-item` | Individual navigation link row |
| `#main` | Right-hand content shell |
| `.topbar` | Sticky top bar with title and actions |
| `.content-area` | Scrollable content region |
| `.split-layout` | Two-column arrangement (tree panel + viewer) |
| `.tree-panel` | Left column within a split layout |
| `.view-panel` | Right column within a split layout |
| `@media (max-width: 900px)` | Collapsed sidebar for narrow viewports |

## Included layouts

| File | Description |
|---|---|
| `default.css` | Fixed left sidebar (228px), sticky topbar, padded content area |
