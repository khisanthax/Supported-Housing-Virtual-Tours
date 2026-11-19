export const requiredScopes=Object.freeze([
 {name:'Account Settings Read',id:'account-settings.read',purpose:'List/select authorized accounts and read account prerequisites'},
 {name:'Workers Scripts Write',id:'workers-scripts.write',purpose:'Create/read Worker code, assets, secrets, versions, deployments and SQLite Durable Object bindings'},
 {name:'D1 Write',id:'d1.write',purpose:'Create the dedicated D1 database, initialize additive schemas, export data and verify approval'},
 {name:'Workers KV Storage Write',id:'workers-kv-storage.write',purpose:'Create the private image namespace, inventory and back up its actual JPEG bytes'}
]);
export function registrationConfiguration({origin,catalog,build}){
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||!/^[a-f0-9]{40}$/.test(build))throw Error('Use the exact approved HTTPS origin and tested 40-character source build.');
 const rows=catalog.scopes??catalog;
 for(const required of requiredScopes)if(!rows.some(row=>row.id===required.id&&row.name===required.name))throw Error('The current OAuth catalog does not confirm every required scope. Refresh catalog discovery before registration.');
 const billing=rows.find(row=>row.name==='Billing Read');
 return {
  registration:{client_name:'LevelTwo360 Agency Setup — private acceptance',grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'client_secret_basic',redirect_uris:[origin+'/oauth/callback'],scopes:requiredScopes.map(s=>s.id),optional_scopes:[],client_uri:origin},
  environment:{AGENCY_ORIGIN:origin,AGENCY_OAUTH_CLIENT_ID:'SET_AFTER_PRIVATE_REGISTRATION',AGENCY_OAUTH_CLIENT_SECRET_FILE:'/run/secrets/agency_oauth_client_secret',AGENCY_OAUTH_SCOPES:requiredScopes.map(s=>s.id).join(' '),AGENCY_STATE_DIRECTORY:'/var/lib/leveltwo360',AGENCY_VERIFIED_BUILD:build,AGENCY_VERIFIED_FREE_PLAN_IDS:'',AGENCY_RELEASE_DIRECTORY:'/run/leveltwo360-release',AGENCY_UPDATE_PUBLIC_KEY_FILE:'/run/leveltwo360-trust/release-public.pem'},
  preflight:{privateOnly:true,publicPromotionAuthorized:false,billingChangesAuthorized:false,productionChangesAuthorized:false,source:catalog.source??'operator-supplied current catalog',freeVerification:{ready:false,requiredPermission:'Billing Read',catalogScope:billing?.id??null,reason:billing?'An isolated account must still validate the real Workers Free subscription response.':'Cloudflare documents Billing Read for GET /accounts/{account_id}/subscriptions, but the live self-managed OAuth catalog has no Billing Read scope. The publisher needs a supported alternative or platform confirmation before automatic deployment can be released.'}}
 };
}
