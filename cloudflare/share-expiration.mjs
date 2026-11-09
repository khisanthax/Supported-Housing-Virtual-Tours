export function shareExpiration(preset,now=Date.now()){
 if(['1d','7d','30d'].includes(preset))return now+Number(preset.slice(0,-1))*86400000;
 if(!['3m','6m'].includes(preset))throw Error('Choose a valid expiration.');
 const date=new Date(now),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+Number(preset[0]));const end=new Date(date);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);date.setUTCDate(Math.min(day,end.getUTCDate()));return date.getTime();
}
