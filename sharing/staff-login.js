const form = document.querySelector('#sign-in');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  const status = document.querySelector('#message');
  status.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/staff/sign-in',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase:form.elements.passphrase.value}) });
    if (!response.ok) throw new Error((await response.json()).error);
    form.reset();
    location.replace('/staff');
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
