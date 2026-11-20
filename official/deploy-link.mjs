import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Release-owner tool. The agency never needs Git or GitHub API credentials.
export async function verifiedButton(source, reviewedTree, request = fetch) {
  const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+)\/?$/.exec(source);
  if (!match || ['.', '..'].includes(match[2])) {
    throw new Error('Use the public GitHub repository root. A branch or subdirectory link can fail during the hosted clone.');
  }
  const slug = match[1] + '/' + match[2];
  const response = await request('https://api.github.com/repos/' + slug + '/commits/HEAD', {
    redirect: 'error',
    headers: {Accept: 'application/vnd.github+json'},
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('Unable to verify the public template default branch (HTTP ' + response.status + ').');
  const data = await response.json();
  if (!/^[a-f0-9]{40}$/.test(reviewedTree) || data.commit?.tree?.sha !== reviewedTree) {
    throw new Error('The default branch files differ from the reviewed checkout. Withhold the invitation until they match.');
  }
  const deploy = new URL('https://deploy.workers.cloudflare.com/');
  deploy.searchParams.set('url', 'https://github.com/' + slug);
  return '[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](' + deploy.href + ')';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8'
    }).trim();
    console.log(await verifiedButton(process.argv[2], tree));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
