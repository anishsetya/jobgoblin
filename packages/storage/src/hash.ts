// SHA-256 fingerprints of files. An approved resume's fingerprint is how everyone can tell that the
// file the person approved is the file that was attached.
// Spec: ARCHITECTURE.md section 7 (fileSha256) and section 5.7 (Approval.pdfSha256).
import { createHash } from "node:crypto";
import fs from "node:fs";

// 64 lowercase hex characters, the same form the Sha256Hex schema accepts.
// This repeats core's sha256Hex on purpose: storage depends only on schemas, not on core.
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileSha256(filePath: string): string {
  return sha256OfBytes(fs.readFileSync(filePath));
}
