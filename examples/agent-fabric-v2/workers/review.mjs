import { migrated } from "./common.mjs";
const approved = migrated();
console.log(JSON.stringify({ verdict: approved ? "approved" : "changes_requested", findings: approved ? [] : ["Selected files are not migrated"] }));
