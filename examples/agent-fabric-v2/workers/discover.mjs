import { files } from "./common.mjs";
console.log(JSON.stringify({ items: files().map(id => ({ id, allowedPaths: [id] })) }));
