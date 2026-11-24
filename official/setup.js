const form = document.querySelector('#setup');
const output = document.querySelector('#message');
const generated = document.querySelector('#generated');

document.querySelector('#generate').onclick = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const code = btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
  generated.value = code + '.' + (Date.now() + 30 * 60 * 1000);
  generated.hidden = false;
  generated.focus();
  generated.select();
};

form.onsubmit = async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  if (button.disabled) return;
  const {code,username,password,confirmation} = Object.fromEntries(new FormData(form));
  if (password !== confirmation) { output.textContent = 'The passwords do not match.'; return; }
  button.disabled = true;
  output.textContent = 'Creating your Administrator…';
  try {
    const reply = await fetch('/api/official/enroll', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code,username,password})
    });
    const result = await reply.json();
    if (!reply.ok) { output.textContent = result.error; return; }
    form.reset();
    generated.value = '';
    form.hidden = true;
    document.querySelector('#configure').hidden = true;
    document.querySelector('#ready').hidden = false;
    document.querySelector('#ready a').focus();
    output.textContent = 'Administrator created.';
  } catch {
    output.textContent = 'The connection stopped. Reload this page to see if setup is done.';
  } finally {
    form.elements.password.value = form.elements.confirmation.value = '';
    button.disabled = false;
  }
};
