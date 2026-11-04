const message = document.querySelector('#message');
const manage = document.querySelector('#manage');
async function request(method, body) {
  const response = await fetch('/api/staff/accounts', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function refresh() {
  const { accounts, currentUsername } = await request('GET');
  document.querySelector('#accounts').replaceChildren(...accounts.map(account => {
    const item = document.createElement('li');
    item.textContent = account.username + ' · ' + account.role + (account.disabled ? ' · Disabled' : '');
    return item;
  }));
  manage.elements.username.replaceChildren(...accounts.filter(account => account.username !== currentUsername)
    .map(account => new Option(account.username, account.username)));
}
for (const [form, method] of [[document.querySelector('#create'), 'POST'], [manage, 'PATCH']]) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await request(method, Object.fromEntries(new FormData(form)));
      form.reset();
      await refresh();
      message.textContent = 'Account updated.';
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
refresh().catch(error => { message.textContent = error.message; });
