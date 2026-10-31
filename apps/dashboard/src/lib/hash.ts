// Fingerprints a file in the browser, so "I submitted" can check that the resume the person attached
// to the form is the exact file they approved. The file never leaves the computer; only the
// fingerprint is sent. Spec: PRD T2 and U4, ARCHITECTURE.md section 8.6.

export async function sha256HexOfFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
