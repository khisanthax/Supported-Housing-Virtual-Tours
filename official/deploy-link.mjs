const source = process.argv[2];
try {
  const repo = new URL(source);
  if (repo.origin !== 'https://github.com' || repo.username || repo.password || repo.hash || repo.search ||
      !/^\/[\w.-]+\/[\w.-]+\/?$/.test(repo.pathname) || repo.pathname.split('/').some(segment=>segment==='.'||segment==='..'))
    throw Error();
  const deploy = new URL('https://deploy.workers.cloudflare.com/');
  deploy.searchParams.set('url',repo.href);
  console.log('[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)]('+deploy.href+')');
} catch {
  console.error('Provide the HTTPS URL of the approved GitHub template repository.');
  process.exitCode = 1;
}
