// Experimental worker only. Embind generates trusted JS bindings at runtime.
// Keep the application's document/production CSP unchanged and deny worker network access.
export const captureWorkerCSP="default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
export const captureWorkerHeaderBlock='/capture/stitch-worker.js\n  Content-Security-Policy: '+captureWorkerCSP+'\n';

export function applyCaptureWorkerHeaders(text){return text.replace(/(?:^|\n)\/capture\/stitch-worker\.js\r?\n(?:[ \t][^\n]*(?:\n|$))*/g,'\n').trimEnd()+'\n\n'+captureWorkerHeaderBlock;}
