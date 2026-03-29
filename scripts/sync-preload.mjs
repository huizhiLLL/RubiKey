import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, "app", "main", "preload.cjs");
const targetDir = path.join(rootDir, "dist-electron", "main");
const targetPath = path.join(targetDir, "preload.cjs");

mkdirSync(targetDir, { recursive: true });
copyFileSync(sourcePath, targetPath);
