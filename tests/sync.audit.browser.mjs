// Two isolated browser profiles share a mocked Sanity server. No production requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const documents = new Map([['workspace-w', {
  _id: 'workspace-w', _type: 'workspace', _rev: 'initial', syncOwner: 'user-a', workspaceId: 'w',
  _createdAt: '2026-10-09T09:00:00Z', createdAt: '2026-10-09T09:00:00Z', name: 'Shared workspace',
  githubRepo: { owner: 'test', repo: 'test', fullName: 'test/test', url: '', defaultBranch: 'main' },
  activeBranchName: 'main', branches: [{ _key: 'main', name: 'main', activeDocumentId: 'd', taskDocuments: [{
    _key: 'd', id: 'd', name: 'TASKS.md', path: 'TASKS.md', folder: '',
    content: '# Tareas\n\n## General\n- [ ] Write report\n  id: x\n  priority: P1\n',
  }] }],
}]]);
const independent = structuredClone(documents.get('workspace-w'));
independent._id = 'workspace-q'; independent.workspaceId = 'q'; independent.name = 'Independent workspace';
documents.set(independent._id, independent);
const listeners = new Set();
let revision = 0, mutations = 0;
let holdNextWorkspaceWrite = false, releaseWorkspaceWrite;
const api = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin || '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  const json = (data, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data));
  };
  if (request.method === 'OPTIONS') return json({});
  if (url.pathname.includes('/users/me')) return json({ id: 'user-a', displayName: 'Test user' });
  if (url.pathname.includes('/data/listen')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.write('event: welcome\ndata: {"type":"welcome"}\n\n');
    listeners.add(response); request.on('close', () => listeners.delete(response)); return;
  }
  if (url.pathname.includes('/data/doc/')) {
    const ids = decodeURIComponent(url.pathname.split('/').pop()).split(',');
    return json({ documents: ids.map(id => documents.get(id)).filter(Boolean) });
  }
  if (url.pathname.includes('/data/query')) {
    const query = url.searchParams.get('query') || '';
    const id = JSON.parse(url.searchParams.get('$id') || 'null');
    let result = [...documents.values()];
    if (query.includes('_id == $id')) result = documents.get(id) || null;
    else if (query.includes('_type == "workspace"')) result = result.find(d => d._type === 'workspace' && d.workspaceId === id) || null;
    else if (query.includes('_type == "task"')) result = result.filter(d => d._type === 'task' && d.workspaceId === id);
    return json({ result, ms: 1 });
  }
  if (url.pathname.includes('/data/mutate')) {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw), transactionId = `test-${++revision}`;
    if (holdNextWorkspaceWrite && body.mutations.some(mutation => mutation.patch?.id === 'workspace-w')) {
      holdNextWorkspaceWrite = false;
      await new Promise(resolve => { releaseWorkspaceWrite = resolve; });
    }
    for (const mutation of body.mutations) {
      const old = documents.get(mutation.patch?.id || mutation.create?._id);
      if (mutation.create ? old : !old || old._rev !== mutation.patch.ifRevisionID) {
        return json({ error: { type: 'mutationError', description: 'Revision conflict' } }, 409);
      }
    }
    mutations++;
    const results = body.mutations.map(mutation => {
      const id = mutation.patch?.id || mutation.create._id, previous = documents.get(id);
      const document = structuredClone(mutation.create || { ...previous, ...mutation.patch.set });
      for (const key of mutation.patch?.unset || []) delete document[key];
      document._rev = `revision-${++revision}`;
      document._createdAt ||= '2026-10-09T09:00:00Z'; document._updatedAt = new Date().toISOString();
      documents.set(id, document);
      for (const listener of listeners) listener.write(`event: mutation\ndata: ${JSON.stringify({
        type: 'mutation', documentId: id, transition: 'update', result: document, previous, transactionId,
      })}\n\n`);
      return { id, document, operation: mutation.create ? 'create' : 'update' };
    });
    return json({ transactionId, results });
  }
  return json([]);
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const apiOrigin = `http://127.0.0.1:${api.address().port}`;
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4189'], { windowsHide: true, stdio: 'ignore' });
const browsers = [];
async function waitUntil(predicate, message) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(100); }
  throw new Error(message);
}
async function openBrowser(executable, port) {
  const profile = await mkdtemp(join(tmpdir(), 'antask-collab-'));
  const processHandle = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--disable-features=msImplicitSignin',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let pages;
  await waitUntil(async () => { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.length; } catch { return false; } }, 'Browser did not start');
  return attachPage(processHandle, pages.find(p => p.type === 'page'));
}
async function attachPage(processHandle, page, inheritedWriter) {
  const browser = { processHandle, errors: [] }; browsers.push(browser);
  browser.socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { browser.socket.onopen = resolve; browser.socket.onerror = reject; });
  let sequence = 0; const pending = new Map();
  browser.send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); browser.socket.send(JSON.stringify({ id, method, params }));
  });
  browser.socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id); pending.delete(message.id);
      clearTimeout(handler?.timer);
      if (message.error) handler?.reject(new Error(message.error.message)); else handler?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') browser.errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params, original = new URL(request.url);
      await browser.send('Fetch.continueRequest', { requestId, url: apiOrigin + original.pathname + original.search });
    }
  };
  browser.evaluate = async expression => {
    const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await browser.send('Runtime.enable'); await browser.send('Page.enable');
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*sanity.io*' }] });
  const config = { projectId: 'mockproject', dataset: 'production', apiVersion: '2024-03-01', token: 'fake-a', useCdn: false };
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `${inheritedWriter ? `if(!sessionStorage.getItem('antask_sync_writer'))sessionStorage.setItem('antask_sync_writer',${JSON.stringify(inheritedWriter)});` : ''}localStorage.setItem('antaskcanvas_sanity_config',${JSON.stringify(JSON.stringify(config))});localStorage.setItem('antask_welcome_dismissed','true');localStorage.setItem('antask_split_view','true');window.syncEvents=[];const originalInfo=console.info;console.info=function(...args){if(args[0]==='[sync]')window.syncEvents.push(args[1]);return originalInfo.apply(this,args)};` });
  await browser.send('Page.navigate', { url: 'http://127.0.0.1:4189/' });
  await waitUntil(() => browser.evaluate("document.body?.innerText.includes('Write report')"), 'Shared task did not load');
  await browser.evaluate("if(!document.querySelector('.cm-content'))document.querySelector('#btn-toggle-split-view-top')?.click()");
  await waitUntil(() => browser.evaluate("!!document.querySelector('.cm-content')"), 'Markdown editor did not open');
  browser.content = () => browser.evaluate("document.querySelector('.cm-content')?.cmTile.root.view.state.doc.toString() || ''");
  browser.edit = (old, value) => browser.evaluate(`(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;const text=view.state.doc.toString();const from=text.indexOf(${JSON.stringify(old)});if(from<0)throw Error('Text to edit was not found');view.dispatch({changes:{from,to:from+${old.length},insert:${JSON.stringify(value)}}});})()`);
  return browser;
}
try {
  await waitUntil(async () => { try { return (await fetch('http://127.0.0.1:4189')).ok; } catch { return false; } }, 'Preview did not start');
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert(existsSync(edge) && existsSync(chrome), 'This browser test requires Edge and Chrome on Windows');
  const a = await openBrowser(edge, 9338), b = await openBrowser(chrome, 9339);
  await waitUntil(() => Promise.resolve(listeners.size >= 2), 'Both realtime streams did not connect');
  await pause(500);
  const writer = await a.evaluate("sessionStorage.getItem('antask_sync_writer')");
  const created = await a.send('Target.createTarget', { url: 'about:blank' });
  const pages = await (await fetch('http://127.0.0.1:9338/json/list')).json();
  const tab = await attachPage({ kill() {} }, pages.find(page => page.id === created.targetId), writer);
  assert.notEqual(await tab.evaluate("sessionStorage.getItem('antask_sync_writer')"), writer, 'A new tab reused its inherited writer identity');
  await Promise.all([a.edit('Write report', 'Draft Write report'), tab.edit('Write report', 'Write report today')]);
  await waitUntil(async () => (await a.content()).includes('Draft Write report today') && await a.content() === await tab.content() &&
    await a.content() === await b.content(), 'Same-profile tabs did not converge after compatible edits');
  const tabWriter = await tab.evaluate("sessionStorage.getItem('antask_sync_writer')");
  await tab.send('Page.reload');
  await waitUntil(() => tab.evaluate("performance.getEntriesByType('navigation')[0]?.type==='reload' && !!document.querySelector('.cm-content')").catch(() => false), 'Reloaded tab did not load');
  assert.equal(await tab.evaluate("sessionStorage.getItem('antask_sync_writer')"), tabWriter, 'Reload changed the offline journal writer');
  await a.send('Target.closeTarget', { targetId: created.targetId });
  browsers.splice(browsers.indexOf(tab), 1); tab.socket.close();
  holdNextWorkspaceWrite = true;
  await a.edit('Write report', 'Write report pending');
  await waitUntil(() => Promise.resolve(!!releaseWorkspaceWrite), 'The delayed save did not start');
  await a.edit('pending', 'pending complete');
  releaseWorkspaceWrite();
  await waitUntil(async () => await a.content() === await b.content() &&
    (await a.content()).includes('Draft Write report pending complete today'), 'Typing during an acknowledged save duplicated or lost text');
  // A conflict in one workspace must preserve both versions and allow another workspace to pull.
  await a.edit('Write report', 'Alpha report'); await b.edit('Write report', 'Beta report');
  await waitUntil(async () => (await a.evaluate("window.syncEvents.some(e=>e.result==='conflict')")) ||
    (await b.evaluate("window.syncEvents.some(e=>e.result==='conflict')")), 'Incompatible edits were not reported as a conflict');
  const conflictContents = [await a.content(), await b.content()];
  assert(conflictContents.some(content => content.includes('Alpha report')));
  assert(conflictContents.some(content => content.includes('Beta report')));
  const previous = documents.get('workspace-q'), updated = { ...previous, name: 'Independent remote rename', _rev: 'independent-new' };
  const commented = '<!--\n' + previous.branches[0].taskDocuments[0].content + '\n-->';
  updated.branches = structuredClone(previous.branches);
  updated.branches[0].taskDocuments[0].content = commented;
  documents.set('task-q-stale', { _id: 'task-q-stale', _type: 'task', _rev: 'stale-task', syncOwner: 'user-a',
    workspaceId: 'q', documentKey: 'main::d', taskId: 'x', title: 'Write report', completed: false, priority: 'P1', groupTitle: 'General' });
  documents.set(updated._id, updated);
  for (const listener of listeners) listener.write(`event: mutation\ndata: ${JSON.stringify({
    type: 'mutation', documentId: updated._id, transition: 'update', result: updated, previous,
  })}\n\n`);
  const independentPulled = browser => browser.evaluate(`Object.entries(localStorage).filter(([key])=>key.startsWith('antask_workspaces_v2:')).flatMap(([,value])=>JSON.parse(value).workspaces).some(ws=>ws.id==='q'&&ws.name==='Independent remote rename'&&ws.branches[0].taskDocuments[0].content===${JSON.stringify(commented)})`);
  await waitUntil(async () => await independentPulled(a) && await independentPulled(b), 'A conflicted workspace blocked an independent pull');
  const durableAtPagehide = [];
  for (const [browser, name] of [[a, 'Edge'], [b, 'Chrome']]) {
    const sentinel = '# Last instant edit in ' + name + '\n';
    durableAtPagehide.push(await browser.evaluate(`(()=>{
      const view=document.querySelector('.cm-content').cmTile.root.view;
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:${JSON.stringify(sentinel)}}});
      window.dispatchEvent(new Event('pagehide'));
      return Object.entries(localStorage).filter(([key])=>key.startsWith('antask_workspaces_v2:'))
        .flatMap(([,value])=>JSON.parse(value).workspaces).flatMap(ws=>ws.branches)
        .flatMap(branch=>branch.taskDocuments).some(doc=>doc.content===${JSON.stringify(sentinel)});
    })()`));
  }
  console.log(JSON.stringify({ browsers: ['Edge', 'Chrome'], typingDuringSave: true, commentedProjectionSuppressed: true, sameProfileTabs: true, inheritedWriterIsolated: true, reloadWriterPreserved: true, realConflictPreserved: true, independentPullDuringConflict: true, durableAtPagehide }));
  assert.deepEqual(durableAtPagehide, [true, true], 'Live editor input is absent from durable storage at pagehide');
} catch(error) {
  for (const browser of browsers) {
    try { console.error(JSON.stringify({events:await browser.evaluate('window.syncEvents'),documents:[...documents.values()].filter(d=>d._type==='workspace'),errors:browser.errors,body:await browser.evaluate("document.body?.innerText.slice(-1800)")})); }
    catch (diagnosticError) { console.error(diagnosticError.message); }
  }
  throw error;
} finally {
  for (const browser of browsers) { try { await browser.send?.('Browser.close'); } catch {} browser.socket?.close(); browser.processHandle.kill(); }
  for (const listener of listeners) listener.end(); api.closeAllConnections(); api.close(); preview.kill();
}
