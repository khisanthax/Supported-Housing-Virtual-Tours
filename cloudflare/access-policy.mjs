// Pure policy evaluation. Callers must load these inputs from authoritative server state.
export const ROLES=Object.freeze(['administrator','staff','client']);
export const PERMISSIONS=Object.freeze({
 'apartment.view':{},'apartment.create':{},'apartment.edit':{},'apartment.archive':{},'image.upload':{},'apartment.publish':{},'apartment.unpublish':{},'apartment.private.view':{},
 'gallery.public.view':{client:true},'gallery.visibility.manage':{newCapability:true},'inventory.restricted.view':{},
 'invitation.create':{},'invitation.multi.create':{},'invitation.view':{},'invitation.revoke':{},'invitation.regenerate':{},
 'accounts.manage':{protected:true},'roles.assign':{protected:true},'permissions.manage':{protected:true},'scope.manage':{protected:true},'audit.view':{protected:true},'recovery.manage':{protected:true},
 'backup.export':{},'backup.import':{},'storage.cleanup':{}
});
export const normalizeRole=role=>role==='editor'?'staff':ROLES.includes(role)?role:null;
export function defaultPermissions(role){role=normalizeRole(role);return Object.fromEntries(Object.entries(PERMISSIONS).map(([id,p])=>[id,role==='administrator'||role==='staff'&&!p.protected&&!p.newCapability||role==='client'&&!!p.client]));}
export function effectivePermission({role,rolePolicy={},overrides={},disabled=false},action){
 role=normalizeRole(role);const definition=PERMISSIONS[action];
 if(disabled||!role||!definition)return {allowed:false,reason:'Disabled or unknown principal/permission'};
 if(definition.protected)return {allowed:role==='administrator',reason:'Protected Administrator boundary'};
 if(role==='client')return {allowed:!!definition.client,reason:'Read-only Client boundary'};
 const override=overrides[action];if(override==='allow'||override==='deny')return {allowed:override==='allow',reason:'Individual '+override};
 const value=rolePolicy[action];return {allowed:typeof value==='boolean'?value:defaultPermissions(role)[action],reason:typeof value==='boolean'?'Configured role policy':'Role default'};
}
export function authorize(principal,action,resource){
 const permission=effectivePermission(principal,action);if(!permission.allowed)return permission;
 const role=normalizeRole(principal.role);
 if(resource&&role==='staff'&&principal.scope?.mode==='selected'&&!principal.scope.apartments?.includes(resource.id))return {allowed:false,reason:'Apartment outside assigned scope'};
 if(resource&&role==='staff'&&!['all','selected'].includes(principal.scope?.mode))return {allowed:false,reason:'Missing apartment scope'};
 if(resource&&role==='client'&&(!resource.published||!resource.public))return {allowed:false,reason:'Not a public published apartment'};
 return permission;
}
