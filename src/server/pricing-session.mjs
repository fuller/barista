import directory from '../catalog/data/starbucks-menu-directory.json' with {type:'json'};
const cookieName='barista_quote';
const valid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

export function readExistingQuoteSession(request){
 const matches=(request.headers.get('Cookie')??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));
 const supplied=matches.length===1?matches[0].slice(cookieName.length+1):'';
 return valid(supplied)?supplied:null;
}
export function getQuoteSession(request){return readExistingQuoteSession(request)??crypto.randomUUID();}
export function initializeQuoteSession(request,response,session=getQuoteSession(request)){
 response.headers.set('Set-Cookie',`${cookieName}=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=900${new URL(request.url).protocol==='https:'?'; Secure':''}`);return response;
}
export async function quoteCacheScope(session){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('barista-price-cache-v1:'+directory.version+':'+session));
 return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
