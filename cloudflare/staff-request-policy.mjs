import {authorize,effectivePermission,normalizeRole} from './access-policy.mjs';
const hex='[a-f0-9]{32}';
export function staffRequestPolicy(method,path,body={}){
 if(path==='/api/staff/sign-out'&&method==='POST')return {actions:[]};
 if(path==='/api/staff/accounts')return {actions:['accounts.manage']};
 if(path.startsWith('/api/staff/uac'))return {actions:[method==='GET'?'audit.view':'permissions.manage']};
 if(path==='/api/staff/dashboard'&&method==='GET')return {actions:['apartment.view'],list:'dashboard'};
 if(path==='/api/staff/offline'&&method==='GET')return {actions:['apartment.view'],list:'apartments'};
 if(path==='/api/staff/photos'&&method==='POST')return {actions:['image.upload']};
 if(path==='/api/staff/cleanup'&&method==='POST')return {actions:['storage.cleanup'],global:true};
 if(path==='/api/staff/apartments'&&method==='POST')return {actions:[body.replacement?'apartment.edit':'apartment.create'],apartments:body.replacement?[body.replacement]:[],photos:body.photos};
 let m=new RegExp('^/api/staff/(drafts|tours|offline)/('+hex+')(?:/(manifest|thumbnail|images/[a-z0-9-]+))?$').exec(path);
 if(m&&method==='GET')return {actions:['apartment.view',...(m[1]==='tours'&&m[3]==='manifest'?['backup.export']:[])],apartments:[m[2]]};
 m=new RegExp('^/api/staff/apartments/('+hex+')$').exec(path);
 if(m&&method==='PATCH'){const action={publish:'apartment.publish',unpublish:'apartment.unpublish',archive:'apartment.archive',remove:'apartment.archive',restore:'backup.import'}[body.action];return action?{actions:[action],apartments:[m[1]]}:null;}
 if(path==='/api/staff/shares'&&method==='POST')return {actions:['invitation.create',...(body.apartments?.length>1?['invitation.multi.create']:[])],apartments:body.apartments};
 m=new RegExp('^/api/staff/shares/('+hex+')(?:/(phrase))?$').exec(path);
 if(m){const action=m[2]&&method==='POST'?'invitation.regenerate':method==='DELETE'?'invitation.revoke':method==='PATCH'?'invitation.create':null;if(action)return {actions:[action],share:m[1],apartments:method==='PATCH'?body.apartments:[],multi:method==='PATCH'};}
 return null;
}
export async function enforceStaffRequest(principal,method,path,body,shareApartments){
 const rule=staffRequestPolicy(method,path,body);
 const deny=reason=>{throw Object.assign(Error(reason),{status:403});};
 if(!principal||!['administrator','staff'].includes(normalizeRole(principal.role)))deny('Staff principal required');
 if(!rule)deny('Unknown staff operation');
 for(const action of rule.actions){const result=effectivePermission(principal,action);if(!result.allowed)deny(result.reason);}
 if(rule.global&&normalizeRole(principal.role)==='staff'&&principal.scope?.mode!=='all')deny('Global storage operation requires all-apartment scope');
 let ids=rule.apartments??[];
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!new RegExp('^'+hex+'$').test(id)))deny('Invalid apartment selection');
 if(rule.share){const existing=await shareApartments(rule.share);if(!existing?.length)deny('Invitation not available');ids=[...ids,...existing];}
 if(rule.multi&&(body.apartments?.length??0)>1&&!effectivePermission(principal,'invitation.multi.create').allowed)deny('Multi-apartment invitations are not permitted');
 for(const id of ids){const result=authorize(principal,rule.actions[0],{id});if(!result.allowed)deny('Apartment access denied');}
 return rule;
}
export function visibleApartments(principal,apartments){return apartments.filter(a=>authorize(principal,'apartment.view',{id:a.id}).allowed);}
export function visibleInvitations(principal,invitations){if(!effectivePermission(principal,'invitation.view').allowed)return [];return invitations.filter(s=>s.apartments.length&&s.apartments.every(id=>authorize(principal,'apartment.view',{id}).allowed));}
