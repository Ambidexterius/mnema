// Streams files into a ZIP without compression: media is already compressed and memory stays flat.
import { createReadStream } from 'node:fs';
import { crc32 } from 'node:zlib';
import type { Writable } from 'node:stream';

const FLAGS = 0x0808; // bit 3: sizes follow the data; bit 11: UTF-8 names
const DOS_DATE = 0x21; // 1 January 1980; real dates are not needed for a download bundle

/** Unique names inside the archive: «Отчёт.pdf», «Отчёт (2).pdf». */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/]/g, '_') || 'файл';
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) + ' (' + n + ')' + name.slice(dot) : name + ' (' + n + ')';
  });
}

// shortcut: no ZIP64, a project over 4 GB in total fails; switch to ZIP64 when projects grow that large.
export async function writeZip(out: Writable, files: { name: string; path: string }[]) {
  let offset = 0;
  const central: { name: Buffer; crc: number; size: number; start: number }[] = [];
  const write = (chunk: Buffer) =>
    new Promise<void>((done, fail) => {
      offset += chunk.length;
      if (offset > 0xffffffff) return fail(new Error('Архив больше 4 ГБ.'));
      out.write(chunk) ? done() : out.once('drain', done);
    });
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8'),
      start = offset,
      head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(FLAGS, 6);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt16LE(name.length, 26);
    await write(Buffer.concat([head, name]));
    let crc = 0,
      size = 0;
    for await (const chunk of createReadStream(file.path)) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      await write(chunk);
    }
    const tail = Buffer.alloc(16);
    tail.writeUInt32LE(0x08074b50, 0);
    tail.writeUInt32LE(crc, 4);
    tail.writeUInt32LE(size, 8);
    tail.writeUInt32LE(size, 12);
    await write(tail);
    central.push({ name, crc, size, start });
  }
  const directory = offset;
  for (const c of central) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(FLAGS, 8);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(c.crc, 16);
    head.writeUInt32LE(c.size, 20);
    head.writeUInt32LE(c.size, 24);
    head.writeUInt16LE(c.name.length, 28);
    head.writeUInt32LE(c.start, 42);
    await write(Buffer.concat([head, c.name]));
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - directory, 12);
  end.writeUInt32LE(directory, 16);
  await write(end);
  out.end();
}
