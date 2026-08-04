import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

const outputPath = path.resolve("trucea-extension.zip");
const output = fs.createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });
archive.pipe(output);
archive.directory(path.resolve("dist"), false);
await archive.finalize();
console.info(`Created ${outputPath}`);
