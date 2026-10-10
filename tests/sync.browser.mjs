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
const listeners = new Set();
let revision = 0, mutations = 0;
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
  const browser = { processHandle, errors: [] }; browsers.push(browser);
  let pages;
  await waitUntil(async () => { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.length; } catch { return false; } }, 'Browser did not start');
  browser.socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
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
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('antaskcanvas_sanity_config',${JSON.stringify(JSON.stringify(config))});localStorage.setItem('antask_welcome_dismissed','true');localStorage.setItem('antask_split_view','true');window.syncEvents=[];const originalInfo=console.info;console.info=function(...args){if(args[0]==='[sync]')window.syncEvents.push(args[1]);return originalInfo.apply(this,args)};` });
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
  // A remote-only edit must reach the active editor without publishing its old text.
  await pause(1500);
  const beforeRemoteOnly = mutations;
  const previous = documents.get('workspace-w'), remoteOnly = structuredClone(previous);
  remoteOnly._rev = `remote-only-${++revision}`;
  remoteOnly.branches[0].taskDocuments[0].content += '\nRemote-only note\n';
  documents.set(remoteOnly._id, remoteOnly);
  for (const listener of listeners) listener.write(`event: mutation\ndata: ${JSON.stringify({
    type: 'mutation', documentId: remoteOnly._id, transition: 'update', result: remoteOnly, previous,
  })}\n\n`);
  await waitUntil(async () => (await a.content()).includes('Remote-only note') && (await b.content()).includes('Remote-only note'), 'Remote-only edit did not reach the active editors');
  await pause(1500);
  assert.equal(mutations, beforeRemoteOnly, 'Hydration published obsolete local content');
  for (const browser of [a, b]) {
    const checkpoint = await browser.evaluate("JSON.parse(Object.entries(localStorage).find(([key])=>key.startsWith('antask_workspaces_v2:'))[1])");
    assert.equal(checkpoint.remoteBase[0]._rev, remoteOnly._rev);
    assert(checkpoint.workspaces[0].branches[0].taskDocuments[0].content.includes('Remote-only note'));
    const event = await browser.evaluate(`window.syncEvents.find(event=>event.operation==='pull'&&event.documentId==='workspace-w'&&event.remoteRev===${JSON.stringify(remoteOnly._rev)})`);
    assert.equal(event.result, 'success'); assert.equal(event.baseRev, previous._rev);
    assert.equal(event.user, 'user-a'); assert(event.syncId); assert.equal(typeof event.session, 'string');
  }
  const cursor = await b.evaluate("(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;const head=view.state.doc.toString().indexOf('Write')+3;view.dispatch({selection:{anchor:head}});return head})()");
  await a.edit('Write report', 'Write final report');
  await waitUntil(async () => (await b.content()).includes('Write final report'), 'A edit did not reach B');
  assert.equal(await b.evaluate("document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head"), cursor, 'Remote text moved the active cursor');
  await a.edit('final report', 'final updated report');
  await waitUntil(async () => (await b.content()).includes('final updated report'), 'Second A edit was blocked by an old revision');
  await b.edit('[ ]', '[x]');
  await waitUntil(async () => (await a.content()).includes('[x]'), 'B checkbox did not reach A');
  await Promise.all([a.edit('Write ', 'Draft '), b.edit('report', 'report today')]);
  await waitUntil(async () => (await a.content()).includes('Draft final updated report today') && await a.content() === await b.content(), 'Concurrent title edits did not converge');
  await pause(1800);
  const beforeTyping = mutations;
  await a.evaluate(`(()=>{
    window.typingStoreWrites=0;
    const setItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key.startsWith('antask_workspaces_v2'))window.typingStoreWrites++;return setItem.call(this,key,value)};
  })()`);
  for (const character of ' typingburst') {
    await a.evaluate(`(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;const from=view.state.doc.toString().indexOf('\\n  id:');view.dispatch({changes:{from,insert:${JSON.stringify(character)}}});})()`);
    await pause(80);
  }
  assert((await a.content()).includes('today typingburst'), 'Editor input was delayed or lost');
  const typingStoreWrites = await a.evaluate('window.typingStoreWrites');
  assert(typingStoreWrites <= 1, `Typing serialized the workspace ${typingStoreWrites} times`);
  assert.equal(mutations, beforeTyping, 'Typing triggered remote saves before the debounce settled');
  await waitUntil(async () => (await b.content()).includes('today typingburst'), 'Debounced edits did not reach the other browser');
  for (const [name, content] of [['README.md', '# First readme\n'], ['README.md', '# Second readme\n']]) {
    await a.evaluate(`(()=>{const input=document.querySelector('#div-app-root > input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:'text/markdown'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    // Receiving a new file preserves this tab's selection. Verify replication, then open it.
    let receivedId;
    await waitUntil(async () => {
      receivedId = await b.evaluate(`Object.entries(localStorage).filter(([key])=>key.startsWith('antask_workspaces_v2:')).flatMap(([,value])=>JSON.parse(value).workspaces).flatMap(ws=>ws.branches).flatMap(branch=>branch.taskDocuments).find(doc=>doc.content===${JSON.stringify(content)})?.id`);
      return !!receivedId;
    }, 'Imported Markdown did not reach the other browser store');
    await b.evaluate("if(!document.querySelector('[id^=div-doc-item-]'))document.querySelector('#btn-toggle-sidebar')?.click()");
    await waitUntil(() => b.evaluate(`!!document.getElementById(${JSON.stringify('div-doc-item-')}+${JSON.stringify(receivedId)})`), 'Imported document did not appear in the explorer');
    await b.evaluate(`document.getElementById(${JSON.stringify('div-doc-item-')}+${JSON.stringify(receivedId)}).click()`);
    await waitUntil(async () => await b.content() === content, 'Imported Markdown did not reach the other browser');
  }
  const savedDocs = documents.get('workspace-w').branches[0].taskDocuments;
  assert.equal(savedDocs.length, 3, 'Import replaced an existing document');
  assert.equal(new Set(savedDocs.map(doc => doc.id)).size, 3, 'Imported document identities collided');
  assert(savedDocs[0].content.includes('today typingburst'), 'Import overwrote the original task document');
  assert.deepEqual(savedDocs.slice(1).map(doc => doc.content), ['# First readme\n', '# Second readme\n']);
  await a.evaluate("if(!document.querySelector('#btn-branch-selector-trigger, #btn-explorer-branch-dropdown'))document.querySelector('#btn-toggle-sidebar').click()");
  await waitUntil(() => a.evaluate("!!document.querySelector('#btn-branch-selector-trigger, #btn-explorer-branch-dropdown')"), 'Branch selector did not open');
  for (const [name, source] of [['feature-copy', 'main'], ['fresh', '']]) {
    await a.evaluate("document.querySelector('#btn-branch-selector-trigger, #btn-explorer-branch-dropdown')?.click()");
    await waitUntil(() => a.evaluate("!!document.querySelector('#btn-new-branch-dropdown, #btn-explorer-new-branch')"), 'Branch menu did not open');
    await a.evaluate("document.querySelector('#btn-new-branch-dropdown, #btn-explorer-new-branch').click()");
    await waitUntil(() => a.evaluate("!!document.querySelector('#new-branch-name')"), 'New branch dialog did not open');
    assert.equal(await a.evaluate("document.querySelector('#new-branch-source').value"), 'main', 'New branches must default to main');
    await a.evaluate(`(()=>{const input=document.querySelector('#new-branch-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('#new-branch-source');select.value=${JSON.stringify(source)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await a.evaluate("document.querySelector('#btn-submit-new-branch').click()");
    await waitUntil(() => Promise.resolve(documents.get('workspace-w').branches.some(branch => branch.name === name)), 'New branch did not reach Sanity');
    await waitUntil(() => b.evaluate(`Object.keys(localStorage).filter(key=>key.startsWith('antask_workspaces_v2')).some(key=>JSON.parse(localStorage.getItem(key)).workspaces.some(ws=>ws.branches.some(branch=>branch.name===${JSON.stringify(name)})))`), 'New branch did not reach the other browser');
  }
  const branches = documents.get('workspace-w').branches;
  const main = branches.find(branch => branch.name === 'main'), copy = branches.find(branch => branch.name === 'feature-copy');
  assert.deepEqual(copy.taskDocuments.map(doc => doc.content), main.taskDocuments.map(doc => doc.content));
  assert(copy.taskDocuments.every(doc => !main.taskDocuments.some(original => original.id === doc.id)));
  assert.equal(branches.find(branch => branch.name === 'fresh').taskDocuments[0].content, '# Tareas\n\n## General\n');
  assert.equal(await a.evaluate("document.body.innerText.includes('Draft final updated report today typingburst')"), false, 'Empty branch retained main canvas tasks');
  await a.evaluate("[...document.querySelectorAll('button')].find(button=>button.innerText.includes('Sync & Override'))?.click()");
  await waitUntil(() => a.evaluate("document.querySelectorAll('[data-document-path=\"README.md\"]').length===4"), 'Sync view did not distinguish Markdown files across branches');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
  console.log(JSON.stringify({ browsers: ['Edge', 'Chrome'], isolatedProfiles: true, sequentialEdits: true,
    bidirectionalRealtime: true, remoteOnlyNoOverwrite: true, concurrentTitleEdits: true, cursorPreserved: true, typingStoreWrites,
    typingDebounced: true, separateMarkdownFiles: true, cloneAndEmptyBranches: true, mutations, uncaughtErrors: 0 }));
} catch(error) {
  for (const browser of browsers) {
    try { console.error(JSON.stringify({errors:browser.errors,body:await browser.evaluate("document.body?.innerText.slice(-1800)")})); }
    catch (diagnosticError) { console.error(diagnosticError.message); }
  }
  throw error;
} finally {
  for (const browser of browsers) { try { await browser.send?.('Browser.close'); } catch {} browser.socket?.close(); browser.processHandle.kill(); }
  for (const listener of listeners) listener.end(); api.closeAllConnections(); api.close(); preview.kill();
}
