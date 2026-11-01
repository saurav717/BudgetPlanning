/* Runs the Ledger Python engine (Pyodide) off the main thread.
   Messages in:  {id, type: 'init'|'request'|'export'|'token', ...}
   Messages out: {id, ok, result} | {id, ok:false, error} | {type:'progress', text} */
const PYODIDE_VERSION = '0.27.7';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
// Pinned to versions compatible with the pydantic that ships in this Pyodide release.
const WHEELS = ['starlette-0.46.2-py3-none-any.whl', 'fastapi-0.115.12-py3-none-any.whl', 'python_multipart-0.0.20-py3-none-any.whl'];

let py = null, bridge = null, booting = null;
const progress = (text) => postMessage({ type: 'progress', text });

async function boot(base) {
  progress('Loading the Python engine…');
  importScripts(PYODIDE_URL + 'pyodide.js');
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  progress('Loading packages…');
  await py.loadPackage(['sqlite3', 'pydantic', 'micropip', 'anyio', 'sniffio', 'idna', 'typing-extensions', 'annotated-types']);
  const micropip = py.pyimport('micropip');
  await micropip.install(WHEELS.map(w => new URL('wheels/' + w, base).href), { deps: false });
  progress('Loading Ledger…');
  const zip = await (await fetch(new URL('ledger.zip', base).href, { cache: 'no-cache' })).arrayBuffer();
  py.unpackArchive(zip, 'zip', { extractDir: '/home/pyodide' });
  py.runPython('import sys; sys.path.insert(0, "/home/pyodide")');
  bridge = py.pyimport('ledger.browser');
}

async function handle(msg) {
  switch (msg.type) {
    case 'init': {
      await (booting ||= boot(msg.base));
      progress(msg.data ? 'Opening your data…' : msg.demo ? 'Generating sample data…' : 'Creating your ledger…');
      const data = msg.data ? py.toPy(new Uint8Array(msg.data)) : null;
      const res = bridge.init(data, !!msg.demo, py.toPy(msg.settings || {}));
      const out = res.toJs({ dict_converter: Object.fromEntries });
      res.destroy(); data && data.destroy();
      return out;
    }
    case 'warm': await (booting ||= boot(msg.base)); return true;
    case 'token': await booting; bridge && bridge.set_relay_token(msg.token || null); return true;
    case 'request': {
      const body = msg.body == null ? '' : typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body);
      const out = await bridge.handle(msg.method, msg.path, msg.query || '', body, msg.contentType || 'application/json');
      return JSON.parse(out);
    }
    case 'export': {
      const b = bridge.export_db();
      const arr = b.toJs(); b.destroy();
      return arr;  // Uint8Array
    }
    default: throw new Error('unknown message ' + msg.type);
  }
}

// Requests are processed one at a time so SQLite never sees interleaved writes.
let queue = Promise.resolve();
onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(() => handle(msg)).then(
    (result) => postMessage({ id: msg.id, ok: true, result }, result instanceof Uint8Array ? [result.buffer] : []),
    (err) => postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) }));
};
