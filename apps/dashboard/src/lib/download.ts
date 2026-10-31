// Gives the person a file the dashboard fetched itself (a resume PDF, the CSV or Excel tracker).
// The files come from routes that need the session key, so a plain link would not work; the
// dashboard fetches the bytes first and hands the browser a temporary local address for them.
// It is always a download through a clicked <a download> link, never window.open(blob:...), because
// the desktop app (Electron) refuses to open blob addresses in a new window.

const REVOKE_AFTER_MS = 60_000;

export function saveBlobAs(blob: Blob, fileName: string): void {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the temporary address goes away.
  window.setTimeout(() => URL.revokeObjectURL(address), REVOKE_AFTER_MS);
}
