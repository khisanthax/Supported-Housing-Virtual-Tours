export function safeBackupLabel(value){
 const label=String(value??'').normalize('NFKD').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'').replace(/\d[\d ()+-]{6,}\d/g,'').replace(/(?:password|token|secret|passphrase)\s*[=:]\s*\S+/gi,'').replace(/[^a-zA-Z0-9 -]/g,' ').trim().replace(/[ -]+/g,'-').slice(0,64).replace(/-+$/,'');
 return !label||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(label)?'Apartment':label;
}
export function backupFilename(label){const time=new Date().toISOString().replace(/[-:]/g,'').slice(0,15).replace('T','-');const suffix=Array.from(crypto.getRandomValues(new Uint8Array(3)),b=>b.toString(16).padStart(2,'0')).join('');return safeBackupLabel(label)+'-'+time+'-'+suffix+'.shtour.zip';}
