# Token values — new-landingpage-view

Mapping from the artwork colours in `reports/design/project/Main.dc.html` (SVG `fill` / `stroke` attributes) to the tokens in `src/styles/global.css`. The `--illustration-*` values are identical in `:root` and `.dark` and are published as Tailwind colours through `@theme inline` (`--color-illustration-*`), so SVGs reference them as `var(--illustration-*)` and views as `fill-illustration-*` / `text-illustration-*`. Conversion: sRGB → linear → OKLab → OKLCH, rounded to 3 decimals.

## Illustration palette (new)

| Design hex | Token                       | Value (`:root` and `.dark`)  |
| ---------- | --------------------------- | ---------------------------- |
| `#1a1426`  | `--illustration-outline`    | `oklch(0.208 0.036 298.588)` |
| `#f7f8fb`  | `--illustration-highlight`  | `oklch(0.979 0.004 271.37)`  |
| `#c3c9d8`  | `--illustration-line`       | `oklch(0.836 0.022 268.4)`   |
| `#3b4570`  | `--illustration-navy`       | `oklch(0.402 0.074 272.76)`  |
| `#f7c948`  | `--illustration-gold`       | `oklch(0.854 0.15 88.68)`    |
| `#c9952b`  | `--illustration-gold-deep`  | `oklch(0.702 0.131 80.525)`  |
| `#8a5a12`  | `--illustration-gold-ink`   | `oklch(0.509 0.103 70.834)`  |
| `#7dd3c0`  | `--illustration-teal`       | `oklch(0.807 0.088 178.148)` |
| `#f5c38a`  | `--illustration-peach`      | `oklch(0.849 0.093 69.715)`  |
| `#a5b4fc`  | `--illustration-periwinkle` | `oklch(0.785 0.104 274.713)` |
| `#f19a9a`  | `--illustration-blush`      | `oklch(0.774 0.105 19.729)`  |
| `#f2c7a5`  | `--illustration-skin-1`     | `oklch(0.859 0.067 60.069)`  |
| `#c98e64`  | `--illustration-skin-2`     | `oklch(0.695 0.092 56.029)`  |
| `#8d5a3b`  | `--illustration-skin-3`     | `oklch(0.517 0.081 51.423)`  |
| `#3b2a20`  | `--illustration-hair-1`     | `oklch(0.302 0.031 51.662)`  |
| `#22181a`  | `--illustration-hair-2`     | `oklch(0.222 0.016 5.134)`   |
| `#2a1d17`  | `--illustration-hair-3`     | `oklch(0.245 0.023 45.886)`  |

## Reused existing tokens

| Design hex | Token                                    | Value                                              | Note                                                                                                                       |
| ---------- | ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `#d2b1f7`  | `--primary`                              | `.dark` `oklch(0.827 0.119 306.383)` (= `#dab2ff`) | Design lilac is `oklch(0.813 0.103 305.765)`; the app's primary is used instead, a slightly lighter, more saturated lilac. |
| `#34d39a`  | `--success`                              | `.dark` `oklch(0.765 0.177 163.223)` (= `#00d492`) | Design green is `oklch(0.773 0.153 163.623)`; the app's success colour is used instead.                                    |
| `#000000`  | `var(--illustration-outline)` or `black` | `oklch(0 0 0)` with the design's `fill-opacity`    | Shadow shapes keep their `fill-opacity` as a plain number, which the UI literal guard accepts.                             |

One checkmark `stroke="#0d1222"` (`oklch(0.186 0.034 269.751)`, the design's page background) is not in the plan's list; it is meant to read as the background showing through, so it maps to `var(--background)` (`.dark` `oklch(0.166 0.026 269.4)` = `#0a0e1a`) rather than a new token.

## Font families (new, `@theme inline`)

| Design family | Token            | Utility        | Stack                                                                       |
| ------------- | ---------------- | -------------- | --------------------------------------------------------------------------- |
| Space Grotesk | `--font-heading` | `font-heading` | `"Space Grotesk", ui-sans-serif, system-ui, sans-serif`                     |
| IBM Plex Sans | `--font-body`    | `font-body`    | `"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif`                     |
| IBM Plex Mono | `--font-figures` | `font-figures` | `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

`--font-sans` and `--font-mono` are unchanged (Tailwind defaults).
