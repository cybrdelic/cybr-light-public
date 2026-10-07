import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLoader } from './scene-loader.mjs';
function harness(options) {
  const workers = [];
  const loader = createSceneLoader(() => {
    const w = {
      terminated: false,
      postMessage(request) {
        this.request = request;
      },
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(w);
    return w;
  }, options);
  return { loader, workers };
}
test('superseded jobs reject and stale progress/results cannot publish', async () => {
  const { loader, workers } = harness();
  const progress = [];
  const first = loader.load({ scene: 'old' }, (p) => progress.push(p));
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const stale = workers[0].onmessage;
  const second = loader.load({ scene: 'new' }, (p) => progress.push(p));
  await rejected;
  assert.equal(workers[0].terminated, true);
  stale({ data: { progress: 'old' } });
  stale({ data: { scene: 'old' } });
  workers[1].onmessage({ data: { progress: 'building' } });
  workers[1].onmessage({ data: { scene: 'new' } });
  assert.deepEqual(await second, { scene: 'new' });
  assert.deepEqual(progress, ['building']);
  assert.equal(workers[1].terminated, true);
});
test('worker errors and timeout preserve exact failure and release the worker', async () => {
  for (const kind of ['reported', 'crash', 'message', 'timeout']) {
    const { loader, workers } = harness({ timeoutMs: 10 });
    const result = loader.load({});
    const check = assert.rejects(result, /specific|unreadable|timed out/);
    if (kind === 'reported')
      workers[0].onmessage({ data: { error: 'specific error' } });
    if (kind === 'crash') workers[0].onerror({ message: 'specific crash' });
    if (kind === 'message') workers[0].onmessageerror();
    await check;
    assert.equal(workers[0].terminated, true);
  }
});
test('synchronous worker startup failures settle and the next job can succeed', async () => {
  const loader = createSceneLoader(() => {
    throw Error('startup failed');
  });
  await assert.rejects(loader.load({}), /startup failed/);
  loader.cancel();
});

test('successful reusable workers retain caches until cancellation or failure',async()=>{
 const {loader,workers}=harness({reuse:true});
 const first=loader.load({id:1});workers[0].onmessage({data:{id:1}});await first;
 assert.equal(workers[0].terminated,false);
 const second=loader.load({id:2});assert.equal(workers.length,1);
 workers[0].onmessage({data:{id:2}});await second;
 loader.cancel();assert.equal(workers[0].terminated,true);
 const third=loader.load({id:3}),failed=assert.rejects(third,/bad/);
 workers[1].onerror({message:'bad'});await failed;assert.equal(workers[1].terminated,true);
});
