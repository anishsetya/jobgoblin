// Helpers to paste into the built-in browser (javascript_tool) on an application form page.
// Paste the whole file once per page load; every function is then available on `window`.
// Learned the hard way on Stripe (Greenhouse): see docs/ATS_PLAYBOOK.md.

window.sleep = ms => new Promise(r => setTimeout(r, ms));

// Set a React-controlled <input>/<textarea> by id. Plain `.value =` is ignored by React.
window.setText = (id, val) => {
  const el = document.getElementById(id);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
};

// Scroll a react-select control to the middle of the viewport and return click coordinates.
// Built-in browser: coordinates are scaled to an 800 px-wide screenshot frame.
// Claude-in-Chrome: set `window.__chrome = true` first; coordinates are then raw viewport pixels
// (a 0.6-scale screenshot is 1272 px wide).
// Use `window.scrollTo` (not scrollIntoView): the pages use smooth scrolling.
// Then click those coordinates with the real `computer` tool: synthetic events do NOT open react-select.
// Layout shifts after every selection, so call focusCtl again (and screenshot) before each click.
// Not for the phone-country picker (intl-tel-input): scroll to the top and click it from a screenshot.
window.focusCtl = async id => {
  const el = document.getElementById(id);
  const ctl = el.closest('[class*="select__control"]') || el;
  const abs = ctl.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: Math.max(0, abs - window.innerHeight / 2), behavior: 'instant' });
  await sleep(500);
  const r = ctl.getBoundingClientRect();
  const k = window.__chrome ? 1 : 800 / window.innerWidth;
  return [Math.round((r.left + r.width / 2) * k), Math.round((r.top + r.height / 2) * k)];
};

// After the real click opened the menu: pick an option. EXACT or STARTS-WITH only, never `includes`
// ("No" matched inside "now" and silently chose "Yes, I will require visa sponsorship").
window.choose = async (id, text) => {
  const t = text.toLowerCase();
  const opts = [...document.querySelectorAll('[class*="select__option"]')];
  const hit = opts.find(o => o.innerText.trim().toLowerCase() === t)
           || opts.find(o => o.innerText.trim().toLowerCase().startsWith(t));
  if (!hit) return 'NO MATCH ' + text + ' among ' + JSON.stringify(opts.map(o => o.innerText.trim()).slice(0, 12));
  hit.click();
  await sleep(350);
  return id + ' => ' + document.getElementById(id).closest('[class*="select__control"]')?.innerText.trim();
};

// LEGACY (built-in browser only). In Claude-in-Chrome use the `file_upload` tool instead.
// Attach a resume stashed in window.name by the loader (see docs/ATS_PLAYBOOK.md, "Uploading the resume").
// `b64` is the base64 string for this application's PDF.
window.attachPdf = async (inputId, b64, expectedSha256) => {
  const u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (expectedSha256 && sha !== expectedSha256) return 'CHECKSUM MISMATCH ' + sha;
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'Resume.pdf', { type: 'application/pdf' }));
  const inp = document.getElementById(inputId);
  inp.files = dt.files;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(2500);
  return /Resume\.pdf/.test(document.body.innerText) ? 'attached ' + u8.length + ' bytes, sha ok' : 'upload not shown';
};

// Final sanity check before Submit: every required field has a visible value and no error markers.
window.requiredReport = () => {
  const missing = [];
  document.querySelectorAll('input[aria-required="true"], textarea[aria-required="true"], input[required], textarea[required]').forEach(e => {
    if (['checkbox', 'hidden', 'search', 'file'].includes(e.type)) return;
    const ctl = e.closest('[class*="select__control"]');
    if (!(ctl ? ctl.innerText.trim() : e.value)) missing.push(e.id || e.name || '(unnamed)');
  });
  return { missing, errors: [...document.querySelectorAll('[role="alert"], [aria-invalid="true"]')].map(e => (e.innerText || e.id).trim().slice(0, 100)).filter(Boolean) };
};
// ---- Compact helpers: use these instead of read_page / screenshots (they cost far fewer tokens) ----

const _label = e => {
  const l = (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest('label') ||
            document.getElementById(e.getAttribute('aria-labelledby') || '');
  return ((l && l.innerText) || e.getAttribute('aria-label') || e.placeholder || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 90);
};
const _isSelect = e => !!e.closest('[class*="select__control"]');
const _fields = () => [...document.querySelectorAll('input, textarea, select')]
  .filter(e => !['hidden', 'search', 'submit', 'button'].includes(e.type) && !e.closest('[class*="select__menu"]') &&
               !(e.type === 'text' && e.getAttribute('role') === 'combobox' && !_isSelect(e)));

// Compact form description, one line per field: id | kind | * if required | label.
// Dropdown options are NOT included here (menus are closed): call `optionsOf(id)` after a real click opens one.
window.formSchema = () => {
  const out = [], seen = new Set();
  for (const e of _fields()) {
    const key = e.type === 'radio' ? e.name : (e.id || e.name);
    if (seen.has(key)) continue; seen.add(key);
    const kind = e.type === 'file' ? 'file' : _isSelect(e) ? 'select' : e.tagName === 'SELECT' ? 'native-select' : e.type === 'radio' ? 'radio' : e.type === 'checkbox' ? 'checkbox' : e.tagName === 'TEXTAREA' ? 'textarea' : 'text';
    const req = e.required || e.getAttribute('aria-required') === 'true' ? '*' : '';
    let extra = '';
    if (kind === 'native-select') extra = ' [' + [...e.options].map(o => o.text.trim()).join(' | ').slice(0, 300) + ']';
    if (kind === 'radio') extra = ' [' + [...document.getElementsByName(e.name)].map(r => _label(r)).join(' | ') + ']';
    out.push(`${e.id || e.name} | ${kind} | ${req} | ${_label(e)}${extra}`);
  }
  return out.join('\n');
};

// Options of the react-select menu currently open (after the real click from `focusCtl`).
window.optionsOf = () => [...document.querySelectorAll('[class*="select__option"]')].map(o => o.innerText.trim()).join(' | ');

// Fill many plain text/textarea fields in one call: fillAll({first_name: 'the user', ...}).
// Returns only the ids that failed (missing element); selects, radios and files are handled separately.
window.fillAll = map => {
  const bad = [];
  for (const [id, v] of Object.entries(map)) {
    if (!document.getElementById(id)) { bad.push(id); continue; }
    setText(id, v);
  }
  return bad.length ? 'MISSING: ' + bad.join(', ') : 'filled ' + Object.keys(map).length;
};

// Read every field back as plain text (replaces screenshots for verification). Long answers are truncated.
window.readBack = () => {
  const out = [], seen = new Set();
  for (const e of _fields()) {
    const key = e.type === 'radio' ? e.name : (e.id || e.name);
    if (seen.has(key)) continue; seen.add(key);
    let v;
    if (e.type === 'file') v = [...document.querySelectorAll('[class*="file"], [class*="attachment"]')].map(x => x.innerText.trim()).find(t => /\.pdf/i.test(t)) || (e.files[0] && e.files[0].name) || '';
    else if (e.type === 'radio') v = ([...document.getElementsByName(e.name)].find(r => r.checked) ? _label([...document.getElementsByName(e.name)].find(r => r.checked)) : '');
    else if (e.type === 'checkbox') v = e.checked ? 'checked' : 'unchecked';
    else if (_isSelect(e)) v = e.closest('[class*="select__control"]').innerText.trim().replace(/\s+/g, ' ');
    else v = e.value;
    out.push(`${_label(e).slice(0, 50)} = ${String(v).slice(0, 80)}`);
  }
  return out.join('\n');
};
'helpers loaded'
