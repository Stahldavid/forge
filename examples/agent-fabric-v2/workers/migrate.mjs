import { writeFileSync } from "node:fs";
import { selected } from "./common.mjs";
for (const path of selected()) writeFileSync(path, "new");
console.log(JSON.stringify({ summary: "Converted selected text files to new" }));
