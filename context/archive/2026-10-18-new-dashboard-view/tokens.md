# Token values — new-dashboard-view

Mapping from the status and surface colours in `reports/design/project/Dashboard.dc.html` and `DashboardEmployee.dc.html` (inline `style` values) to the tokens in `src/styles/global.css`. New roles are declared in `:root` and `.dark` and published through `@theme inline` as `--color-warning`, `--color-warning-foreground`, `--color-info`, `--color-info-foreground`, so views use `text-warning`, `bg-warning/15`, `text-info`, `bg-info/15` and so on. Conversion: sRGB → linear → OKLab → OKLCH, rounded to 3 decimals (as in `context/archive/2026-10-18-new-landingpage-view/tokens.md`).

## Status roles (new)

| Design hex | Used for in the mockup                                           | Token                  | `.dark` value                | `:root` (light) value      |
| ---------- | ---------------------------------------------------------------- | ---------------------- | ---------------------------- | -------------------------- |
| `#f5c38a`  | "Zakończony" / awaiting pill, awaiting tile and row tint, alerts | `--warning`            | `oklch(0.849 0.093 69.715)`  | `oklch(0.5 0.12 60)`       |
| —          | text on a solid warning surface                                  | `--warning-foreground` | `oklch(0.205 0 0)`           | `oklch(0.985 0 0)`         |
| `#a5b4fc`  | "Aktywny" pill                                                   | `--info`               | `oklch(0.785 0.104 274.713)` | `oklch(0.48 0.17 274.713)` |
| —          | text on a solid info surface                                     | `--info-foreground`    | `oklch(0.205 0 0)`           | `oklch(0.985 0 0)`         |

The `.dark` values are the exact conversions of the mockup hex (the same values as `--illustration-peach` / `--illustration-periwinkle`, kept as separate semantic roles so status colours do not depend on the artwork palette). No lightness adjustment was needed (see contrast below).

The app runs dark; the `:root` values are light-theme counterparts chosen darker so the text stays readable on white: peach becomes a burnt amber (`#934f00`), periwinkle a deep indigo (`#454dbb`), same hue family. The `*-foreground` roles follow the `primary` pattern: dark ink on the light `.dark` fills, near-white on the dark `:root` fills.

## Reused existing tokens

| Design hex / value       | Mockup use                               | Token                  | `.dark` value                                                    | Note                                                                        |
| ------------------------ | ---------------------------------------- | ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `#d2b1f7`                | links, bar fill (default accent), avatar | `--primary`            | `oklch(0.827 0.119 306.383)` (= `#dab2ff`)                       | Design lilac is `oklch(0.813 0.103 305.765)`; app primary used instead.     |
| `#34d39a`                | "Zatwierdzony" pill, paid total          | `--success`            | `oklch(0.765 0.177 163.223)` (= `#00d492`)                       | Design green is `oklch(0.773 0.153 163.623)`; app success used instead.     |
| `#f4a3a3`                | over-budget pill, bar and alert icons    | `--destructive`        | `oklch(0.704 0.191 22.216)` (= `#ff6467`)                        | Design red is `oklch(0.795 0.097 19.428)`; over-budget keeps `destructive`. |
| `rgba(255,255,255,0.04)` | tile and section surface                 | `--card`               | `oklch(1 0 0 / 10%)`                                             | App card is white 10%; the mockup's 4% is not a new token.                  |
| `rgba(255,255,255,0.08)` | bar track, row dividers                  | `--muted` / `--border` | `oklch(1 0 0 / 5%)` / `oklch(1 0 0 / 10%)`                       | Track uses `bg-muted`, dividers `border`.                                   |
| `#aeb5c6`                | labels, hints, secondary text            | `--muted-foreground`   | `oklch(0.932 0.032 255.585 / 70%)` (≈ `#9ca8ba` over background) | Design grey is `oklch(0.773 0.025 267.869)`.                                |
| `rgba(255,255,255,0.1)`  | tile and section border                  | `--border`             | `oklch(1 0 0 / 10%)`                                             | Exact match.                                                                |

Tints: the mockup uses 18% (pill), 8% (awaiting tile), 6% (awaiting row). Badge variants use `/15` (`bg-success/15 text-success`, `bg-warning/15 text-warning`, `bg-info/15 text-info`); the warning `StatTile` uses `border-warning/45 bg-warning/10`.

## Contrast (computed, `.dark`)

WCAG 2.x ratios, oklch → linear sRGB → relative luminance; alpha composited in sRGB over the surface first, as in `context/archive/2026-10-01-ui-projects-panel/tokens.md`. `--card` = white 10% over `--background-accent` (≈ `#272c3e`), the darkest-contrast case; over `--background` (≈ `#222631`) every ratio is higher.

| Pair                                                        | Ratio   | ≥ 4.5:1 |
| ----------------------------------------------------------- | ------- | ------- |
| `--warning` on `--card`                                     | 8.59:1  | yes     |
| `--warning` on its 15% tint over `--card` (`bg-warning/15`) | 6.05:1  | yes     |
| `--warning` on its 18% tint over `--card` (mockup pill)     | 5.62:1  | yes     |
| `--warning-foreground` on `--warning`                       | 11.15:1 | yes     |
| `--info` on `--card`                                        | 6.92:1  | yes     |
| `--info` on its 15% tint over `--card` (`bg-info/15`)       | 5.07:1  | yes     |
| `--info` on its 18% tint over `--card` (mockup pill)        | 4.75:1  | yes     |
| `--info-foreground` on `--info`                             | 8.98:1  | yes     |
| `--success` on its 15% tint over `--card` (`bg-success/15`) | 5.35:1  | yes     |

Pill text passes 4.5:1 with the pure mockup hex, so no `.dark` value was adjusted.

`:root` (light) on white: `--warning` 6.23:1, on its 15% tint 4.99:1; `--info` 6.89:1, on its 15% tint 5.49:1; `--warning-foreground` / `--info-foreground` on their fills 5.96:1 / 6.60:1.
