# Prism Themes

A theme controls the **visual identity** of Prism — colors, typography, and design tokens. All component and layout rules reference CSS variables defined here, so swapping a theme file instantly changes the entire look without touching any HTML or JavaScript.

## How to switch themes

In `prism/index.html`, find this tag near the top of `<head>`:

```html
<link id="prism-theme" rel="stylesheet" href="theme/default.css">
```

Change `href` to point to a different theme file:

```html
<link id="prism-theme" rel="stylesheet" href="theme/brand-acme.css">
```

## How to create a new theme

1. Copy `default.css` to a new file (e.g., `brand-acme.css`)
2. Change the CSS variable values in `:root { }` to match your team's brand
3. Update the `<link id="prism-theme">` tag in `index.html`

## Variables reference

| Variable | Purpose |
|---|---|
| `--sidebar-w` | Sidebar width (also used by layout) |
| `--bg-sidebar` | Sidebar background color |
| `--bg-content` | Main content area background |
| `--bg-card` | Card / panel background |
| `--bg-editor` | Code editor background |
| `--accent` | Primary interactive color (buttons, links, active states) |
| `--accent-hover` | Hover state for accent elements |
| `--text-primary` | Main body text |
| `--text-secondary` | Muted / secondary text |
| `--text-sidebar` | Sidebar nav item text |
| `--text-sidebar-muted` | Sidebar section labels |
| `--border` | Light border (cards, inputs) |
| `--border-dark` | Dark border (sidebar dividers, editor) |
| `--status-*` | Lens status indicator colors |
| `--font` | Body font stack |
| `--font-mono` | Monospace font stack (editor, code) |

## Included themes

| File | Description |
|---|---|
| `default.css` | Dark sidebar, light content, indigo accent |
