# Token values — ui-projects-panel

Raw mapping from the pre-token cosmic literals to the `.dark` token set in `src/styles/global.css`. The theme is on globally via `<html class="dark">` in `src/layouts/Layout.astro`; `color-scheme: dark` lives in the `.dark` block.

## `.dark` (final values)

| Token (`.dark`)              | Final value                             | Maps back to                                      | Replaces literal       |
| ---------------------------- | --------------------------------------- | ------------------------------------------------- | ---------------------- |
| `--background`               | `oklch(0.166 0.026 269.4)`              | `#0a0e1a`                                         | `#0a0e1a`              |
| `--background-accent` (new)  | `oklch(0.201 0.041 269.8)`              | `#0f1529`                                         | `#0f1529`              |
| `--card`                     | `oklch(1 0 0 / 10%)`                    | white @ 10%                                       | `bg-white/10`          |
| `--muted`                    | `oklch(1 0 0 / 5%)`                     | white @ 5%                                        | `bg-white/5`           |
| `--accent`                   | `oklch(1 0 0 / 10%)`                    | white @ 10%                                       | `hover:bg-white/10–20` |
| `--muted-foreground`         | `oklch(0.932 0.032 255.585 / 70%)`      | `#dbeafe` @ 70% (≈ `#9ca8ba` over `--background`) | `text-blue-100/60–80`  |
| `--primary`                  | `oklch(0.827 0.119 306.383)`            | `#dab2ff`                                         | `text-purple-300`      |
| `--primary-foreground`       | `oklch(0.205 0 0)` (unchanged)          | `#171717`                                         | —                      |
| `--ring`                     | `oklch(0.827 0.119 306.383)`            | `#dab2ff`                                         | `ring-purple-300`      |
| `--input`                    | `oklch(1 0 0 / 20%)`                    | white @ 20%                                       | `border-white/20`      |
| `--border`                   | `oklch(1 0 0 / 10%)` (unchanged)        | white @ 10%                                       | `border-white/10`      |
| `--destructive`              | `oklch(0.704 0.191 22.216)` (unchanged) | red-400                                           | `red-*`                |
| `--success` (new)            | `oklch(0.765 0.177 163.223)`            | `#00d492` (emerald-400)                           | `emerald-*`            |
| `--success-foreground` (new) | `oklch(0.985 0 0)`                      | `#fafafa`                                         | `text-emerald-100`     |

`bg-cosmic` = `linear-gradient(to bottom, var(--background), var(--background-accent), var(--background))`.

### Correction to the plan's starting values

The plan's starting values `oklch(0.155 0.02 266)` / `oklch(0.19 0.04 267)` map back to `#080c15` / `#0c1326` — visibly darker than the literals. They were replaced by the exact conversions of `#0a0e1a` (`oklch(0.166 0.026 269.4)`) and `#0f1529` (`oklch(0.201 0.041 269.8)`) so the gradient stays unchanged.

## `:root` (light) counterparts for the new roles

| Token                  | Value                        |
| ---------------------- | ---------------------------- |
| `--background-accent`  | `var(--background)`          |
| `--success`            | `oklch(0.596 0.145 163.225)` |
| `--success-foreground` | `oklch(0.985 0 0)`           |

## Contrast (computed)

WCAG 2.x ratios, oklch → linear sRGB → relative luminance; alpha composited in sRGB over the background first.

| Pair                                                                           | Ratio   | ≥ 4.5:1 |
| ------------------------------------------------------------------------------ | ------- | ------- |
| `--muted-foreground` (70% over `--background`) on `--background`               | 8.00:1  | yes     |
| `--muted-foreground` (70% over `--background-accent`) on `--background-accent` | 7.73:1  | yes     |
| `--primary` on `--background`                                                  | 10.81:1 | yes     |
| `--primary` on `--background-accent`                                           | 10.17:1 | yes     |
| `--primary-foreground` on `--primary`                                          | 10.05:1 | yes     |
| `--success` on `--background`                                                  | 9.96:1  | yes     |

| `--muted-foreground` on `--card` (white 10% over `--background-accent`, ≈ `#272c3e`) | 6.38:1 | yes |
| `--primary` on `--card` (same surface) | 7.75:1 | yes |

No token needed a lightness adjustment.

Visually confirmed by the user on 2026-10-01 (Phase 2 manual checks 2.5–2.8).
