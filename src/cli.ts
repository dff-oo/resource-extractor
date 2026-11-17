import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gameConfig } from './game-config';
import { writeCharacterImages } from './character-images';
import { extractResources } from './extract';

/** The resources repo, checked out next to this one. DFFOO_RESOURCES_OUT overrides it. */
const outputDir = process.env.DFFOO_RESOURCES_OUT ?? resolve(__dirname, '../../dffoogg-resources/data');

async function main(): Promise<void> {
  const config = gameConfig();
  for (const [label, directory] of [['masters', config.masterDir], ['downloaded files', config.dlcDir]] as const) {
    if (!existsSync(directory)) throw new Error(`${label} not found at ${directory}`);
  }
  const extracted = await extractResources(config.masterDir, config.dlcDir);
  await mkdir(outputDir, { recursive: true });
  const files: Record<string, unknown> = {
    characters: extracted.characters,
    enemies: extracted.enemies,
    abilities: extracted.abilities,
    items: extracted.items,
    summons: extracted.summons,
    fields: extracted.fields,
    stages: extracted.stages,
    missions: extracted.missions,
    talks: extracted.talks,
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(resolve(outputDir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }
  const images = writeCharacterImages(config.dlcDir, extracted.characters, resolve(outputDir, 'characters'));
  console.log(
    `wrote ${outputDir} (${extracted.characters.length} characters, ${images} character images, ${extracted.enemies.length} enemies, ${extracted.abilities.length} abilities, ${extracted.stages.length} stages, ${extracted.talks.length} talks, ${extracted.missions.length} missions)`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
