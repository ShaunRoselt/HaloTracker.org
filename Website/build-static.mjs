import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(projectRoot, "dist");
const clientRoot = path.join(distRoot, "client");

await rm(distRoot, { recursive: true, force: true });
await mkdir(path.join(distRoot, "server"), { recursive: true });
await mkdir(clientRoot, { recursive: true });

for (const entry of ["index.html", "styles.css", "app.js", "achievements.js", "game-catalog.js", "i18n.js", "locales", "assets"]) {
  await cp(path.join(projectRoot, entry), path.join(clientRoot, entry), { recursive: true });
}

await cp(path.join(projectRoot, "worker"), path.join(distRoot, "server"), { recursive: true });
for (const entry of ["achievements.js", "game-catalog.js"]) {
  await cp(path.join(projectRoot, entry), path.join(distRoot, "server", entry));
}
