const $ = id => document.getElementById(id);
let token = '';
let authorized = false;
async function showCatalog() {
  const response = await fetch('/api/guest/catalog');
  if (token) return;
  if (!response.ok) {
    $('catalog').replaceChildren();
    authorized = false;
    $('message').textContent = 'Reopen the original guest link to enter its passphrase. The link may have expired or been revoked.';
    return;
  }
  const apartments = await response.json();
  authorized = true;
  $('message').textContent = '';
  $('catalog').replaceChildren(...apartments.map(a=>{
    const card = document.createElement('a');
    card.className='apartment'; card.href='/guest/tour/'+a.id;
    const image = document.createElement('img');
    image.src='/api/guest/tours/'+a.id+'/thumbnail'; image.alt=''; image.loading='lazy';
    const title = document.createElement('h2'); title.textContent=a.title;
    const action = document.createElement('span'); action.textContent='Explore apartment →';
    card.append(image,title,action); return card;
  }));
}
function openLink() {
  token = location.hash.slice(1);
  authorized = false;
  $('catalog').replaceChildren();
  $('unlock').reset();
  $('message').textContent = '';
  $('unlock').hidden = !token;
  $('intro').textContent = token ? 'Enter the passphrase supplied with your link.' : 'Explore the apartments shared with you.';
  if (!token) showCatalog().catch(()=>$('message').textContent='Could not load shared apartments. Please try again.');
}
openLink();
window.addEventListener('hashchange',openLink);
$('unlock').addEventListener('submit',async event=>{
  event.preventDefault();
  const form = event.target, button = form.querySelector('button');
  const requested = token;
  button.disabled=true;
  $('message').textContent='Checking access…';
  try {
    const response = await fetch('/api/guest/unlock',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:requested,passphrase:form.elements.passphrase.value})
    });
    if (requested !== token) return;
    if (!response.ok) throw new Error((await response.json()).error);
    form.reset(); form.hidden=true;
    token = '';
    history.replaceState(null,'','/guest');
    $('intro').textContent='Explore the apartments shared with you.';
    await showCatalog();
  } catch (error) { $('message').textContent=error.message; }
  finally { button.disabled=false; }
});
window.addEventListener('pageshow',event=>{ if(event.persisted && !location.hash) showCatalog().catch(()=>{}); });
setInterval(()=>{ if(authorized) showCatalog().catch(()=>{}); },30000);
