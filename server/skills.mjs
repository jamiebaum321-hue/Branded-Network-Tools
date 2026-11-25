import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { checkLine } from './engagements.mjs';

export const skillLines = {
  'branded-introductions': 'solutions',
  'branded-weekly-update': 'solutions',
  'branded-media-tracker': 'media',
};

// Claude accepts a ZIP with the skill directory and its SKILL.md entry.
export function skillBundle(s, actor, name, res) {
  checkLine(s, actor, skillLines[name]);
  const bytes = readFileSync(new URL('../skills/' + name + '/SKILL.md', import.meta.url));
  const filename = Buffer.from(name + '/SKILL.md');
  const checksum = crc32(bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  local.copy(central, 6, 4, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + bytes.length, 16);
  const zip = Buffer.concat([local, filename, bytes, central, filename, end]);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': zip.length,
    'Content-Disposition': 'attachment; filename="' + name + '.zip"',
    'Cache-Control': 'private, no-store',
  });
  res.end(zip);
}
