/// <reference lib="webworker" />
import { createStoredZipParts, encodeWav } from './export-format';

type Request = { jobId: string } & (
  { type: 'wav'; left: Float32Array; right: Float32Array; gain: number }
  | { type: 'zip'; entries: { name: string; data: Uint8Array<ArrayBuffer> }[] }
);
const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    if (data.type === 'zip') {
      // Blob parts avoid allocating and copying another entire large archive.
      const blob = new Blob(createStoredZipParts(data.entries), { type: 'application/zip' });
      scope.postMessage({ type: 'complete', jobId: data.jobId, blob });
    } else {
      const bytes = encodeWav(data.left, data.right, data.gain);
      scope.postMessage({ type: 'complete', jobId: data.jobId, bytes }, [bytes.buffer]);
    }
  } catch (error) {
    scope.postMessage({ type: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'Audio packaging failed.' });
  }
};
