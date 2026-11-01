// A tiny zip file writer, just big enough to build a .docx (a Word file is a zip of XML files).
// No zip library is installed, and the format is small: each file gets a "local header" followed by its
// compressed bytes, then a "central directory" at the end lists every file, then one closing record.
// Format reference: PKWARE APPNOTE.TXT, sections 4.3.7, 4.3.12 and 4.3.16.
import { crc32, deflateRawSync } from "node:zlib";

export type ZipFile = { name: string; data: Uint8Array };

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_ARCHIVE_SIGNATURE = 0x06054b50;

const VERSION_NEEDED = 20; // zip 2.0: the version that introduced deflate
const UTF8_NAMES_FLAG = 0x0800;
const DEFLATE_METHOD = 8;

// File times are fixed (2026-01-15 10:00:00) so that building the fixture twice gives identical bytes.
// DOS dates count years from 1980 and times count seconds in steps of two.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 15;
const DOS_TIME = (10 << 11) | (0 << 5) | 0;

export function createZip(files: ZipFile[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const entry = describeFile(file);
    const localHeader = buildLocalHeader(entry);

    centralParts.push(buildCentralHeader(entry, offset));
    localParts.push(localHeader, entry.compressed);
    offset += localHeader.length + entry.compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = buildEndRecord(files.length, centralDirectory.length, offset);
  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, endRecord]));
}

type ZipEntry = { name: Buffer; compressed: Buffer; crc: number; uncompressedSize: number };

function describeFile(file: ZipFile): ZipEntry {
  const bytes = Buffer.from(file.data);
  return {
    name: Buffer.from(file.name, "utf8"),
    compressed: deflateRawSync(bytes),
    crc: crc32(bytes),
    uncompressedSize: bytes.length,
  };
}

function buildLocalHeader(entry: ZipEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(UTF8_NAMES_FLAG, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.uncompressedSize, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28); // no extra field
  return Buffer.concat([header, entry.name]);
}

function buildCentralHeader(entry: ZipEntry, localHeaderOffset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4); // version made by
  header.writeUInt16LE(VERSION_NEEDED, 6); // version needed
  header.writeUInt16LE(UTF8_NAMES_FLAG, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  // Bytes 30 to 41 stay zero: no extra field, no comment, disk 0, no file attributes.
  header.writeUInt32LE(localHeaderOffset, 42);
  return Buffer.concat([header, entry.name]);
}

function buildEndRecord(fileCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_ARCHIVE_SIGNATURE, 0);
  record.writeUInt16LE(fileCount, 8); // files in this archive (disk 0 is the only disk)
  record.writeUInt16LE(fileCount, 10); // files in total
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  return record;
}
