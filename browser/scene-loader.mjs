// One owner for worker jobs. Superseded jobs settle; stale events cannot publish.
export function createSceneLoader(
  createWorker,
  { timeoutMs = 300000, reuse = false } = {},
) {
  let active, idle;
  function cancel() {
    active?.finish(new DOMException('Scene load superseded', 'AbortError'));
    idle?.terminate();
    idle = undefined;
  }
  return {
    cancel,
    load(request, onProgress = () => {}) {
      if (active) cancel();
      return new Promise((resolve, reject) => {
        let worker, timer;
        const job = {
          finish(error, value) {
            if (active !== job) return;
            active = undefined;
            clearTimeout(timer);
            if (worker) {
              worker.onmessage = worker.onerror = worker.onmessageerror = null;
              if (reuse && !error) idle = worker;
              else worker.terminate();
            }
            error ? reject(error) : resolve(value);
          },
        };
        active = job;
        try {
          worker = idle || createWorker();
          idle = undefined;
          worker.onmessage = ({ data }) => {
            if (active !== job) return;
            if (data.progress) {
              try {
                onProgress(data.progress);
              } catch (error) {
                job.finish(error);
              }
              return;
            }
            job.finish(data.error ? Error(data.error) : null, data);
          };
          worker.onerror = (event) =>
            job.finish(Error(event.message || 'Scene worker failed'));
          worker.onmessageerror = () =>
            job.finish(Error('Scene worker returned unreadable data'));
          timer = setTimeout(
            () =>
              job.finish(
                Error(
                  `Scene load timed out after ${timeoutMs / 1000}s; no new scene was installed`,
                ),
              ),
            timeoutMs,
          );
          worker.postMessage(request);
        } catch (error) {
          job.finish(error);
        }
      });
    },
  };
}
