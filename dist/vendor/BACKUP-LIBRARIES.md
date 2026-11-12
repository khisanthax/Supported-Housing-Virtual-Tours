# Backup dependencies

Locally bundled, no CDN/runtime service:

- `@noble/ciphers` **2.4.0**, MIT, native Web Crypto AES-GCM wrapper. [Source](https://github.com/paulmillr/noble-ciphers), [Cure53 audit of earlier noble releases](https://cure53.de/audit-report_noble-crypto-libs.pdf). The selected current release and application integration are not claimed to have that exact audit coverage.
- `fflate` **0.8.2**, MIT, ZIP store/unzip only. [Source](https://github.com/101arrowz/fflate). Not a cryptographic implementation.
- Build tool `esbuild` **0.25.12**; bundle format ESM/platform browser/minified. Input: `export { gcm } from '@noble/ciphers/webcrypto.js'; export { zipSync, unzipSync } from 'fflate';`. Build in a temporary directory with these pinned packages, then copy the output and both MIT licenses here. No Node dependencies are needed at runtime.

Registry integrity values:

```
@noble/ciphers@2.4.0 sha512-AnjFn0Jv92laAkvMrghlFZq4qQCIN/4DxFV/eooqtC2YTjB7kBeLMS2T9KJX4Dn+ZVXLOwK0lSgqDtx9gvxtiw==
fflate@0.8.2 sha512-cPJU47OaAoCbg0pBvzsgpTPhmhqI5eJjh/JIu8tPj5q+T7iLvW/JAYUqmE7KOB4R1ZyEhzBaIQpQpardBF5z8A==
```

`backup-crypto.js` SHA-256: `2c9c3764eb43ed7fd661a4c19325e570584ef517ebf576a784067a89c09f770b` (LF bytes).
