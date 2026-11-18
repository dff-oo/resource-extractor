# Resource extractor

Reads a local copy of the global (GL, English) client and writes the JSON name tables and character images the field builder and the server use. Nothing here is typed by hand: every file it writes comes from the client.

```bash
npm install
npm run extract
```

By default it writes `../dff-oo-resources/data`, the resources repo checked out next to this one. `DFFOO_RESOURCES_OUT` changes that.

It reads the device archive from the [game](https://github.com/dff-oo/game) repo, checked out next to this one as `../dff-oo-game` (`DFFOO_GAME_DIR` overrides that). The masters are `archive/data/data/<package>/files` there (`DFFOO_MASTER_ARCHIVE` overrides it) and the downloaded files are `archive/sdcard/Android/data/<package>/files` (`DFFOO_DLC_ARCHIVE`). It stops with an error when either directory is missing, because an extraction without the downloaded files would drop names.

Copy the written files into the field builder's `resources/` and the server's `resources/` when those need the names. Both folders are git-ignored.

The downloaded files hold the client's `MessageData_*.bin.dz` text tables. A `.dz` file is a 132-byte header (u32 chunk count, which is 1 for these tables, u32 unpacked size, u32 packed size) followed by a zlib stream. The unpacked table is `XL` version 19: a 20-byte header, then one u32 offset per id, relative to the start of that table, then NUL-terminated strings. The first offset is the table length, so it also gives the id count.

## Where names live

The GL master archive stores some tables as XOR-0xFF JSON (`N1` + MD5 of `<name>.json`, read by `loadArchiveMaster`) and others as XOR-0xFF binary with an `XL` header (magic `XL`, version 20, count at +4, a stride at +8, header size 16). The stride in the header is not a reliable record size for every file; the extractors below use the framing that was checked against Chapter 1's known ids.

| Resource | Source | How the name is stored |
|---|---|---|
| Characters | `mst_character.bin` | Record 0 is id 1, Cloud, a C string at +4. Later rows use the 12-byte marker `00 30 FF FF FF FF 01 00 00 00 30 00`, then an int32 id, then a C string. Cloud is 1, Vivi is 2, Warrior of Light is 10, Rem is 13, Tifa is 9, Sazh is 14. The int32 68 bytes after the id is `image_id`, the number in the `stl_chara_event_*` and `stl_chara_*` texture names: Vivi is 1, Snow is 8, Lightning is 13, Warrior of Light is 16, Zidane is 24. The `stl_chara_face_*` portraits use different numbers. |
| Enemies | `MessageData_EnemyName`, then `mst_battle_enemy.json` | The message table is indexed by enemy id and wins: Goblin is 1, Skeleton is 4, Flan is 5, Red Bat is 8, Iron Giant is 14, Behemoth is 15, Floating Eye is 38, Miniature Magitek Armor is 67. Ids past its end come from `mst_battle_enemy.json` (binary, despite the suffix), where the name is a u32 length, then ASCII, then a NUL, 830 bytes after the int32 id. That scan misses Flan, Red Bat and Iron Giant; the message table has all three. |
| Abilities | `mst_command_ability.bin` | The English name is repeated three times as u32 length + bytes. A length-prefixed description follows. The next int32 is the command ability id (Fire 17, Cross-Slash 20, Shining Shield 44, Aim 51, Beat Rush 52). Later rows reuse the same name for upgraded ids. |
| Items | JSON masters | Crystals: `mst_crystal` (`cr_id`, item type 9). Summon materials: `mst_summon_material` (`sm_id`, item type 10). Equipment orbs: `mst_equipment_material` (`em_id`, item type 11; High Power Orb is 2). Tickets: `mst_ticket` (`ticket_id`, item type 8; Tutorial Draw Ticket is 2). Gil is item type 99 id 1 and gems are type 99 id 2; those two are currency, not master rows, and the extractor adds them itself. |
| Summons | `mst_summon_beast.json` | `summon_beast_id` and `name`. Ifrit is 1. Chocobo is 4. |
| Fields | `mst_field_disp.json` | `field_map_id`, `name`, `story_part`, `stage_id`. |
| Stages | `S<id>Model` files | The client has no stage names. Each row is the id and the model name (`S001`) of a model file in the downloaded files. |
| Missions | `MessageData_QuestMissionText` | Indexed by mission type: 2 is "Clear without any KO's", 3 is "Clear within %d turns", 4 is "Inflict %d or more Breaks". |
| Talks | `MessageData_TalkEventTitle` | Indexed by talk id, the number a cutscene site stores as `before_talk`. 4 is "The Warrior of Light", 12 is "SOLDIER", 11 is "The World Beyond". The game server reads this table at runtime and sends the title as a cutscene's quest name, so story files store no cutscene names. The scripts are `talk_event_NNN.bin.dz`. |
| Quest names | none | `MessageData_QuestName` exists, but every entry is empty in the global client. The client shows whatever `name` the server sends (checked on device by renaming quest 361), so battle names are typed by hand. |

## Files written

`{characters,enemies,abilities,items,summons,fields,stages,missions,talks}.json`

Each record has an `id` and a `name`, except items, which have `item_type`, `item_id` and `name`, and stages, which have `id` and `model`. Abilities also include `description` with the client's `\b` colour codes left in place. Characters also include `image_id`.

`characters/<image_id>.png` goes to the [cdn](https://github.com/dff-oo/cdn) repo checked out next to this one as `../dff-oo-cdn` (`DFFOO_CDN_DIR` overrides that), not to the resources repo. It is each character's head, taken from `stl_chara_event_<image_id>.g1t.dz`, trimmed to its opaque pixels and halved. Those files hold several `.dz` chunks, so [oo_tool](https://www.npmjs.com/package/oo_tool) unpacks them (`DFFOO_UNPACKER` points at another copy) into a cache in the temp folder. The first run takes several minutes. The texture is one g1t image in format 0x00, 8-bit RGBA.
