import type { ExportJob, ExportReply } from './exportWorker.ts';

/** Takes ownership of both bitmaps, including on worker creation/transfer failure. */
export function runExport(job: ExportJob): { result: Promise<Blob>; cancel(): void } {
  let cancel: () => void = () => {};
  const result = new Promise<Blob>((resolve, reject) => {
    let worker: Worker | undefined;
    const finish = (blob?: Blob) => {
      worker?.terminate();
      worker = undefined;
      if (blob) resolve(blob);
      else reject(new Error('export-failed'));
    };
    cancel = () => finish();
    try {
      worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<ExportReply>) => finish('blob' in data ? data.blob : undefined);
      worker.onmessageerror = () => finish();
      worker.onerror = event => { event.preventDefault(); finish(); };
      worker.postMessage(job, [job.photo, job.layer]);
    } catch {
      job.photo.close();
      job.layer.close();
      finish();
    }
  });
  return { result, cancel };
}
