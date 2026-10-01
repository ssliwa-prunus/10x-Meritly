// UI literal check: fails when a view already on the design-system contract uses a literal colour,
// a Tailwind palette class or an arbitrary px/rem value instead of a token from src/styles/global.css.
// Zero dependencies. `node scripts/check-ui-literals.mjs` checks every clean path; with file arguments
// (lint-staged) it checks only those that are clean paths. Add a view to CLEAN_PATHS once it is migrated.

import { readFileSync } from "node:fs";
import path from "node:path";

const CLEAN_PATHS = [
  "src/pages/projects/[id].astro",
  "src/components/projects/BudgetExposurePanel.astro",
  "src/components/projects/MilestoneForm.astro",
  "src/components/projects/MilestonesSection.astro",
  "src/components/projects/ProjectForm.astro",
  "src/components/SubmitButton.tsx",
  "src/pages/dev/projects-kitchen-sink.astro",
];

const LITERAL =
  /(?<!href=["'][^"'\s]*)#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/;

const toRepoPath = (file) => path.relative(process.cwd(), path.resolve(file)).split(path.sep).join("/");

const args = process.argv.slice(2).map(toRepoPath);
const files = args.length > 0 ? args.filter((file) => CLEAN_PATHS.includes(file)) : CLEAN_PATHS;

let hits = 0;
for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (LITERAL.test(line)) {
        hits++;
        console.error(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
}

if (hits > 0) {
  console.error(
    `\n${hits} literal value(s) in views on the design-system contract. Use token classes (bg-primary, text-muted-foreground, ...) from src/styles/global.css instead.`,
  );
  process.exit(1);
}
console.log(`UI literal check: ${files.length} file(s) clean.`);
