"""Serve tailored resume PDFs on 127.0.0.1 only, with CORS, so the built-in browser can attach them to forms.

Copies the PDFs of the folders named on the command line into a temp directory (nothing else is exposed) and
serves them as http://127.0.0.1:8765/<folder>.pdf.  Stop it with Ctrl+C / by killing the process when done.

Usage: .venv/Scripts/python.exe scripts/serve_resumes.py <application-folder> [<application-folder> ...]
"""
import http.server
import shutil
import socketserver
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
tmp = Path(tempfile.mkdtemp(prefix="resumes_"))
for name in sys.argv[1:]:
    src = ROOT / "applications" / name / "out" / "Resume.pdf"
    shutil.copyfile(src, tmp / f"{name}.pdf")


# loader.html?next=<url>: fetch every served PDF (same-origin), stash them base64-encoded in window.name, then
# navigate this tab to <url>. window.name survives navigation, so form pages (whose CSP blocks any fetch to
# localhost) can read the PDFs from window.name with no network access.
(tmp / "loader.html").write_text("""<!doctype html><meta charset="utf-8"><title>loading resumes</title><body>loading…<script>
(async () => {
  const names = (await (await fetch('manifest.json')).json());
  const out = {};
  for (const n of names) {
    const buf = new Uint8Array(await (await fetch(n + '.pdf')).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    out[n] = btoa(s);
  }
  window.name = JSON.stringify(out);
  location.href = new URLSearchParams(location.search).get('next');
})();
</script>""", encoding="utf-8")
import json as _json
(tmp / "manifest.json").write_text(_json.dumps(sys.argv[1:]), encoding="utf-8")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(tmp), **k)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8765), Handler) as srv:
    print(f"serving {sorted(p.name for p in tmp.iterdir())} from {tmp}", flush=True)
    srv.serve_forever()
