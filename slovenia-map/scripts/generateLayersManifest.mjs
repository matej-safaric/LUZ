// Scans public/data/layers2D for raster files and writes a manifest.json
// listing them, since browser JS has no way to list a folder's contents on
// its own — olMapInit.js just fetches this file at runtime.
//
// Run manually with `node scripts/generateLayersManifest.mjs`, or wire it up
// to run automatically before dev/build — in package.json:
//
//   "scripts": {
//     "predev": "node scripts/generateLayersManifest.mjs",
//     "prebuild": "node scripts/generateLayersManifest.mjs"
//   }
//
// (npm/pnpm/yarn all run "pre<script>" automatically before "<script>".)
//
// Place this file at scripts/generateLayersManifest.mjs in your project
// (the .mjs extension makes Node treat it as ESM regardless of your
// package.json's "type" field).

import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, basename } from 'node:path';

const LAYERS_DIR = join(process.cwd(), 'public', 'data', 'layers2D');
const MANIFEST_PATH = join(LAYERS_DIR, 'manifest.json');
const ALLOWED_EXTENSIONS = new Set(['.tif', '.tiff']);

function humanize(filename) {
    const name = basename(filename, extname(filename));
    return name.replace(/[_-]+/g, ' ').trim();
}

function main() {
    if (!existsSync(LAYERS_DIR)) {
        console.warn(`Layers folder not found at ${LAYERS_DIR} — creating it.`);
        mkdirSync(LAYERS_DIR, { recursive: true });
    }

    const filenames = readdirSync(LAYERS_DIR)
        .filter((f) => ALLOWED_EXTENSIONS.has(extname(f).toLowerCase()))
        .sort();

    const manifest = filenames.map((filename) => ({
        id: basename(filename, extname(filename)),
        filename,
        name: humanize(filename),
    }));

    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${manifest.length} layer(s) to ${MANIFEST_PATH}`);
}

main();
