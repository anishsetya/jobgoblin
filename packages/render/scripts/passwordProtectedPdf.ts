// Builds a tiny one-page PDF that is protected with a password, the same way Word or Acrobat do it
// ("Standard" security handler, AES with a 128-bit key). It exists only to make the test fixture
// fixtures/resumes/broken/password-protected.pdf, because nothing installed on a normal computer can make one.
// A reader that is not given the password (Jobgoblin never is) must refuse it with a "needs a password" error.
// Spec: PDF 1.7 reference, section 7.6 "Encryption"; fixtures/README.md.
import { createCipheriv, createHash } from "node:crypto";

export const FIXTURE_PASSWORD = "jobgoblin";

// The fixed 32 bytes every PDF encryption routine pads a password with (PDF 1.7, algorithm 2, step a).
const PASSWORD_PADDING = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);

// Permissions: everything allowed except what the format forbids. -4 is the usual "all allowed" value.
const PERMISSIONS = -4;
const KEY_BYTES = 16;
const FIRST_OBJECT_WITH_STREAM = 4;

function md5(...parts: Buffer[]): Buffer {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

// RC4, the old stream cipher the PDF format still uses to prove a password is right. Node no longer ships it.
function rc4(key: Buffer, data: Buffer): Buffer {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let swapIndex = 0;
  for (let index = 0; index < 256; index++) {
    swapIndex = (swapIndex + (state[index] ?? 0) + (key[index % key.length] ?? 0)) & 0xff;
    [state[index], state[swapIndex]] = [state[swapIndex] ?? 0, state[index] ?? 0];
  }

  const output = Buffer.alloc(data.length);
  let first = 0;
  let second = 0;
  for (let position = 0; position < data.length; position++) {
    first = (first + 1) & 0xff;
    second = (second + (state[first] ?? 0)) & 0xff;
    [state[first], state[second]] = [state[second] ?? 0, state[first] ?? 0];
    const keyByte = state[((state[first] ?? 0) + (state[second] ?? 0)) & 0xff] ?? 0;
    output[position] = (data[position] ?? 0) ^ keyByte;
  }
  return output;
}

function padPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, "latin1"), PASSWORD_PADDING]).subarray(0, 32);
}

// PDF 1.7 algorithm 2: the key that encrypts everything, made from the password, the owner entry and the file id.
function computeFileKey(password: string, ownerEntry: Buffer, fileId: Buffer): Buffer {
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(PERMISSIONS);

  let key = md5(padPassword(password), ownerEntry, permissions, fileId);
  for (let round = 0; round < 50; round++) key = md5(key.subarray(0, KEY_BYTES));
  return key.subarray(0, KEY_BYTES);
}

// PDF 1.7 algorithm 5: the "user entry" a reader compares to find out whether a typed password is right.
function computeUserEntry(fileKey: Buffer, fileId: Buffer): Buffer {
  let value = rc4(fileKey, md5(PASSWORD_PADDING, fileId));
  for (let round = 1; round <= 19; round++) {
    const roundKey = Buffer.from(fileKey.map((byte) => byte ^ round));
    value = rc4(roundKey, value);
  }
  return Buffer.concat([value, Buffer.alloc(16)]);
}

// Each object is encrypted with its own key, made from the file key and the object's number.
function encryptStream(fileKey: Buffer, objectNumber: number, content: Buffer): Buffer {
  const objectNumberBytes = Buffer.from([objectNumber & 0xff, (objectNumber >> 8) & 0xff, (objectNumber >> 16) & 0xff]);
  const generationBytes = Buffer.from([0, 0]);
  const objectKey = md5(fileKey, objectNumberBytes, generationBytes, Buffer.from("sAlT"));

  // A fixed start value keeps the fixture the same on every run. Real files use a random one.
  const startValue = md5(Buffer.from(`fixture-${objectNumber}`));
  const cipher = createCipheriv("aes-128-cbc", objectKey, startValue);
  return Buffer.concat([startValue, cipher.update(content), cipher.final()]);
}

export function buildPasswordProtectedPdf(): Buffer {
  const fileId = md5(Buffer.from("jobgoblin password-protected fixture"));
  // The owner entry only has to be 32 bytes the file key is built from; nobody ever checks it here.
  const ownerEntry = createHash("sha256").update("jobgoblin fixture owner").digest();
  const fileKey = computeFileKey(FIXTURE_PASSWORD, ownerEntry, fileId);
  const userEntry = computeUserEntry(fileKey, fileId);

  const pageText = Buffer.from("BT /F1 14 Tf 72 720 Td (Alex Rivera - private resume) Tj ET");
  const encryptedText = encryptStream(fileKey, FIRST_OBJECT_WITH_STREAM, pageText);

  const hex = (bytes: Buffer): string => `<${bytes.toString("hex")}>`;
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${encryptedText.length} >>\nstream\n`),
      encryptedText,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from(
      "<< /Filter /Standard /V 4 /R 4 /Length 128 " +
        "/CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF " +
        `/O ${hex(ownerEntry)} /U ${hex(userEntry)} /P ${PERMISSIONS} >>`,
    ),
  ];

  return assemblePdf(objects, `/Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [${hex(fileId)} ${hex(fileId)}]`);
}

// Writes "n 0 obj ... endobj" for each object, then the table of where each one starts, then the trailer.
function assemblePdf(objects: Buffer[], trailerEntries: string): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;

  objects.forEach((body, index) => {
    offsets.push(length);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(object);
    length += object.length;
  });

  const table = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const offset of offsets) table.push(`${String(offset).padStart(10, "0")} 00000 n `);
  table.push("trailer", `<< ${trailerEntries} >>`, "startxref", String(length), "%%EOF", "");
  parts.push(Buffer.from(table.join("\n")));
  return Buffer.concat(parts);
}
