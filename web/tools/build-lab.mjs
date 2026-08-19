// Inline the built lab into ONE html file. The lab is meant to be handed over -
// opened from disk, dropped in a message, published - so it must not depend on
// sibling asset files or a server. Artifact hosts also block external requests,
// which a split bundle would need.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist-lab");
const html = readFileSync(resolve(dist, "lab.html"), "utf8");
const js = readFileSync(resolve(dist, "lab.js"), "utf8");
const css = readFileSync(resolve(dist, "lab.css"), "utf8");

// Replacement STRINGS are not literal: $&, $\', $` and $1 are substitution
// patterns, and a minified bundle contains them. That silently ate characters
// out of the inlined script. Function replacers are taken literally.
const out = html
  .replace(/<script type="module"[^>]*src="[^"]*"><\/script>/, () => "")
  .replace(/<link rel="stylesheet"[^>]*>/, () => "")
  .replace("</head>", () => `<style>\n${css}\n</style>\n</head>`)
  .replace("</body>", () => `<script type="module">\n${js}\n</script>\n</body>`);

const dest = process.argv[2] || resolve(dist, "lab-standalone.html");
writeFileSync(dest, out);
console.log(`${dest}  ${(out.length / 1024).toFixed(0)} KB`);
