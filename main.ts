// Sky Ring Runner — hand-in program (Node 22, standard library only).
//
// The game itself is the game/ folder beside this file: plain static files a
// desktop browser plays offline (game/index.html plus its scripts, no build
// step, no network request). This program hands the entry in: it copies game/
// and screenshots/ to the output directory and writes dossier.json there with
// the vendored make.fun library, so the judge reads the same summary the
// scorer rebuilds. In the grader the output is /output; anywhere else the
// MAKEFUN_OUTPUT_DIR environment variable stands in for it:
//
//   MAKEFUN_OUTPUT_DIR=/tmp/flight-out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The caps the scorer enforces; passing them makes this program refuse what it would refuse. */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyInto(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}

function main() {
  const root = dirname(fileURLToPath(import.meta.url));
  const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  mkdirSync(output, { recursive: true });
  copyInto(join(root, 'game'), join(output, 'game'));
  if (existsSync(join(root, 'screenshots'))) {
    copyInto(join(root, 'screenshots'), join(output, 'screenshots'));
  } else {
    mkdirSync(join(output, 'screenshots'), { recursive: true });
  }

  writeFileSync(join(output, 'dossier.json'), buildDossier(output, CAPS));
  console.log(`Sky Ring Runner handed in: game/, screenshots/ and dossier.json are in ${output}`);
}

main();
