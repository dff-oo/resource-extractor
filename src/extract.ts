import { loadArchiveMaster } from './archive-master';
import { cString, loadXorMaster } from './binary';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMessages, namedRows } from './messages';

export interface Named {
  id: number;
  name: string;
}

export interface Ability extends Named {
  description: string;
}

export interface ItemName {
  item_type: number;
  item_id: number;
  name: string;
}

export interface FieldName extends Named {
  story_part: number;
  stage_id: number;
}

export interface Character extends Named {
  /** The number in the stl_chara_event_* and stl_chara_* texture names. */
  image_id: number;
}

const CHARACTER_MARKER = Buffer.from([
  0x00, 0x30, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00, 0x30, 0x00,
]);
const CHARACTER_IMAGE_OFFSET = 68;

/** mst_character.bin. See the repo README. */
export function readCharacters(buffer: Buffer): Character[] {
  const byId = new Map<number, Character>();
  const read = (idAt: number) => {
    const id = buffer.readInt32LE(idAt);
    const name = cString(buffer, idAt + 4);
    if (id > 0 && id < 1000 && printable(name) && !byId.has(id)) {
      byId.set(id, { id, name, image_id: buffer.readInt32LE(idAt + CHARACTER_IMAGE_OFFSET) });
    }
  };
  read(16);
  let cursor = 0;
  while (cursor < buffer.length) {
    const at = buffer.indexOf(CHARACTER_MARKER, cursor);
    if (at < 0) break;
    read(at + CHARACTER_MARKER.length);
    cursor = at + CHARACTER_MARKER.length;
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * mst_battle_enemy.json is an XL binary. The name length is 830 bytes after the id.
 * The byte after the name is NUL. The first name for an id wins.
 */
export function readEnemies(buffer: Buffer): Named[] {
  const byId = new Map<number, string>();
  for (let offset = 830; offset < buffer.length - 8; offset += 1) {
    const length = buffer.readUInt32LE(offset);
    if (length < 2 || length > 40 || offset + 4 + length >= buffer.length) continue;
    if (buffer[offset + 4 + length] !== 0) continue;
    const name = buffer.subarray(offset + 4, offset + 4 + length).toString('utf8');
    if (!/^[A-Za-z0-9][A-Za-z0-9 .'()-]*$/.test(name)) continue;
    const id = buffer.readInt32LE(offset - 830);
    if (id < 1 || id > 20000 || byId.has(id)) continue;
    byId.set(id, name);
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);
}

/**
 * mst_command_ability.bin. Three copies of the name, then a length-prefixed
 * description, then the ability id. The two ints at +12 and +16 are 1 and 65537
 * on real rows; that rejects strings that merely look like names.
 */
export function readAbilities(buffer: Buffer): Ability[] {
  const byId = new Map<number, Ability>();
  for (let offset = 0; offset < buffer.length - 24; offset += 1) {
    const length = buffer.readUInt32LE(offset);
    if (length < 2 || length > 48) continue;
    const name = buffer.subarray(offset + 4, offset + 4 + length).toString('utf8');
    if (!/^[\x20-\x7e]+$/.test(name)) continue;
    const second = offset + 4 + length;
    const third = second + 4 + length;
    if (third + 4 + length > buffer.length) continue;
    if (buffer.readUInt32LE(second) !== length || buffer.subarray(second + 4, second + 4 + length).toString('utf8') !== name) {
      continue;
    }
    if (buffer.readUInt32LE(third) !== length || buffer.subarray(third + 4, third + 4 + length).toString('utf8') !== name) {
      continue;
    }
    const after = third + 4 + length;
    if (after + 24 > buffer.length) continue;
    const descLen = buffer.readUInt32LE(after);
    if (descLen < 0 || descLen > 500 || after + 4 + descLen + 20 > buffer.length) continue;
    const description = buffer.subarray(after + 4, after + 4 + descLen).toString('utf8');
    const idAt = after + 4 + descLen;
    const id = buffer.readInt32LE(idAt);
    if (id < 1 || id > 100000) continue;
    if (buffer.readInt32LE(idAt + 12) !== 1 || buffer.readInt32LE(idAt + 16) !== 65537) continue;
    if (!byId.has(id)) byId.set(id, { id, name, description });
    offset = idAt;
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function printable(name: string): boolean {
  return name.length > 0 && name.length <= 40 && /^[\x20-\x7e]+$/.test(name);
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object',
  );
}

function num(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

export async function readItems(masterDir: string): Promise<ItemName[]> {
  const [crystals, materials, orbs, tickets] = await Promise.all([
    loadArchiveMaster(masterDir, 'mst_crystal'),
    loadArchiveMaster(masterDir, 'mst_summon_material'),
    loadArchiveMaster(masterDir, 'mst_equipment_material'),
    loadArchiveMaster(masterDir, 'mst_ticket'),
  ]);
  const items: ItemName[] = [
    { item_type: 99, item_id: 1, name: 'Gil' },
    { item_type: 99, item_id: 2, name: 'Gems' },
  ];
  for (const row of rows(crystals)) {
    const name = str(row, 'name');
    if (name) items.push({ item_type: 9, item_id: num(row, 'cr_id'), name });
  }
  for (const row of rows(materials)) {
    const name = str(row, 'name');
    if (name) items.push({ item_type: 10, item_id: num(row, 'sm_id'), name });
  }
  for (const row of rows(orbs)) {
    const name = str(row, 'name');
    if (name) items.push({ item_type: 11, item_id: num(row, 'em_id'), name });
  }
  for (const row of rows(tickets)) {
    const name = str(row, 'ticket_name');
    if (name) items.push({ item_type: 8, item_id: num(row, 'ticket_id'), name });
  }
  return items.sort((a, b) => a.item_type - b.item_type || a.item_id - b.item_id);
}

export async function readSummons(masterDir: string): Promise<Named[]> {
  const master = await loadArchiveMaster(masterDir, 'mst_summon_beast');
  return rows(master)
    .map((row) => ({ id: num(row, 'summon_beast_id'), name: str(row, 'name') }))
    .filter((row) => row.id > 0 && row.name)
    .sort((a, b) => a.id - b.id);
}

export async function readFields(masterDir: string): Promise<FieldName[]> {
  const master = await loadArchiveMaster(masterDir, 'mst_field_disp');
  return rows(master)
    .map((row) => ({
      id: num(row, 'field_map_id'),
      name: str(row, 'name'),
      story_part: num(row, 'story_part'),
      stage_id: num(row, 'stage_id'),
    }))
    .filter((row) => row.id > 0)
    .sort((a, b) => a.id - b.id);
}

const STAGE_MODEL = /^S(\d{3})Model\./i;

/** Stage ids the client ships a model for. Names are not in the client; the builder adds those. */
export async function readStages(dlcDir: string): Promise<{ id: number; model: string }[]> {
  const ids = new Set<number>();
  const stack = [dlcDir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else {
        const match = STAGE_MODEL.exec(entry.name);
        if (match) ids.add(Number(match[1]));
      }
    }
  }
  return [...ids].sort((a, b) => a - b).map((id) => ({ id, model: `S${String(id).padStart(3, '0')}` }));
}

/** Display names win over names scanned from the enemy master. */
function mergeEnemyNames(scanned: Named[], display: Named[]): Named[] {
  const byId = new Map(scanned.map((row) => [row.id, row.name]));
  for (const row of display) byId.set(row.id, row.name);
  return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id);
}

export async function extractResources(masterDir: string, dlcDir: string): Promise<{
  characters: Character[];
  enemies: Named[];
  abilities: Ability[];
  items: ItemName[];
  summons: Named[];
  fields: FieldName[];
  talks: Named[];
  missions: Named[];
  stages: { id: number; model: string }[];
}> {
  const [characters, enemies, abilities, enemyNames, talkTitles, missionTexts] = await Promise.all([
    loadXorMaster(masterDir, 'mst_character.bin'),
    loadXorMaster(masterDir, 'mst_battle_enemy.json'),
    loadXorMaster(masterDir, 'mst_command_ability.bin'),
    loadMessages(dlcDir, 'MessageData_EnemyName'),
    loadMessages(dlcDir, 'MessageData_TalkEventTitle'),
    loadMessages(dlcDir, 'MessageData_QuestMissionText'),
  ]);
  return {
    characters: characters ? readCharacters(characters) : [],
    enemies: mergeEnemyNames(enemies ? readEnemies(enemies) : [], namedRows(enemyNames)),
    abilities: abilities ? readAbilities(abilities) : [],
    items: await readItems(masterDir),
    summons: await readSummons(masterDir),
    fields: await readFields(masterDir),
    talks: namedRows(talkTitles),
    missions: namedRows(missionTexts),
    stages: await readStages(dlcDir),
  };
}
