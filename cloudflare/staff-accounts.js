const message = document.querySelector('#message');
const create = document.querySelector('#create');
const manage = document.querySelector('#manage');
let passwordAccounts = false;
function showField(input, visible) {
  input.closest('label').hidden = !visible;
  input.disabled = !visible;
  if (!visible) input.value = '';
}
function updateResetField() {
  showField(manage.elements.password, passwordAccounts && manage.elements.action.value === 'reset');
}
manage.elements.action.addEventListener('change', updateResetField);
async function request(method, body) {
  const response = await fetch('/api/staff/accounts', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function refresh() {
  const data = await request('GET');
  const { accounts, currentUsername } = data;
  passwordAccounts = data.passwordAccounts === true;
  document.querySelector('#create-title').textContent = passwordAccounts ? 'Create staff account' : 'Link a Firebase account';
  create.querySelector('button').textContent = passwordAccounts ? 'Create account' : 'Link account';
  showField(create.elements.firebaseUid, !passwordAccounts);
  showField(create.elements.email, !passwordAccounts);
  showField(create.elements.password, passwordAccounts);
  manage.elements.action.options[0].textContent = passwordAccounts ? 'Reset password' : 'Send password reset email';
  updateResetField();
  document.querySelector('#accounts').replaceChildren(...accounts.map(account => {
    const item = document.createElement('li');
    item.textContent = account.username + ' · ' + account.role + (account.disabled ? ' · Disabled' : '');
    return item;
  }));
  manage.elements.username.replaceChildren(...accounts.filter(account => account.username !== currentUsername)
    .map(account => new Option(account.username, account.username)));
  create.querySelector('button').disabled = false;
  manage.querySelector('button').disabled = !manage.elements.username.options.length;
}
for (const [form, method] of [[create, 'POST'], [manage, 'PATCH']]) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await request(method, Object.fromEntries(new FormData(form)));
      form.reset();
      updateResetField();
      await refresh();
      message.textContent = 'Account updated.';
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = form === manage && !manage.elements.username.options.length; }
  });
}
refresh().catch(error => { message.textContent = error.message; });
