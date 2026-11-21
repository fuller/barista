import {PRODUCT_IDS} from './identity.mjs';
export const MENU_DIRECTORY_SOURCE_URL='https://www.starbucks.com/apiproxy/v1/ordering/menu';
const invalid=()=>{throw new Error('Invalid menu directory');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const string=(value,max=1000,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.length>0);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const order=value=>value===null||Number.isSafeInteger(value)&&value>=0;
const pathKey=path=>path.map(part=>encodeURIComponent(part.id)).join('/');
const image=value=>{if(value===null)return true;if(!string(value,3000))return false;try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='cloudassets.starbucks.com'&&!url.port&&/^\/is\/image\/(?:sbuxcorp|sbuxcorpstage)\//.test(url.pathname)&&!url.username&&!url.password;}catch{return false;}};
const uri=value=>value===null||string(value,2000)&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\u0000-\u001f\u007f]/u.test(value);
const validPath=value=>Array.isArray(value)&&value.length>0&&value.length<=20&&value.every(part=>exact(part,['id','name'])&&string(part.id,160)&&string(part.name));
function version(content){let hash=14695981039346656037n;for(const char of JSON.stringify(content)){hash^=BigInt(char.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}return 'starbucks-menu-'+hash.toString(16).padStart(16,'0');}
function contentOf(directory){return {schemaVersion:directory.schemaVersion,categories:directory.categories,products:directory.products};}

export function normalizeMenuDirectory({menu,fetchedAt,acquisition='fixture'}={}){
 if(!Array.isArray(menu?.menus)||!menu.menus.length||!string(fetchedAt,100)||!Number.isFinite(Date.parse(fetchedAt))||!['fixture','live'].includes(acquisition))invalid();
 const categories=[],products=[],listings=new Map(),categoryKeys=new Set();
 function walk(nodes,parents=[]){
  if(!Array.isArray(nodes))invalid();
  for(const node of nodes){
   if(!node||!string(node.id,160)||!string(node.name)||!Array.isArray(node.products)||!Array.isArray(node.children))invalid();
   const path=[...parents,{id:node.id,name:node.name}],key=pathKey(path);if(categoryKeys.has(key)||path.length>20)invalid();categoryKeys.add(key);
   const category={pathKey:key,id:node.id,name:node.name,parentPathKey:parents.length?pathKey(parents):null,rootCategory:{...path[0]},path,uri:node.uri??null,displayOrder:node.displayOrder??null,imageURL:node.categoryImageURL??null,heroImageURL:node.heroCategoryImageURL??null};categories.push(category);
   for(const item of node.products){
    if(!item||!/^\d{1,10}$/.test(String(item.productNumber))||!string(item.formCode,80)||!Array.isArray(item.sizes)||item.sizes.some(size=>!exact(size,['sizeCode'])))invalid();
    const productNumber=String(item.productNumber),identity=productNumber+':'+item.formCode;
    const product={identity,productNumber,formCode:item.formCode,name:item.name,description:item.description??null,imageURL:item.imageURL??null,productType:item.productType,defaultSize:item.defaultSize===undefined||item.defaultSize===null?null:{...item.defaultSize},sizes:item.sizes.map(size=>({...size})),availability:item.availability??null,uri:item.uri??null};
    const known=PRODUCT_IDS[productNumber];if(known&&['Hot','Iced'].includes(item.formCode))product.knownProductId=known;
    const previous=listings.get(identity),membership={pathKey:key,path:structuredClone(path),rootCategory:{...path[0]},displayOrder:item.displayOrder??null};
    if(previous){const {categories:memberships,...facts}=previous;if(!same(facts,product))invalid();if(!memberships.some(c=>c.pathKey===key))memberships.push(membership);}
    else{const entry={...product,categories:[membership]};listings.set(identity,entry);products.push(entry);}
   }
   walk(node.children,path);
  }
 }
 walk(menu.menus);
 const content={schemaVersion:1,categories,products};
 return validateMenuDirectory({...content,version:version(content),provenance:{source:'Starbucks website menu',fetchedAt,sourceUrls:[MENU_DIRECTORY_SOURCE_URL],storeContext:null,acquisition}});
}
export function validateMenuDirectory(directory){
 if(!exact(directory,['schemaVersion','categories','products','version','provenance'])||directory.schemaVersion!==1||!Array.isArray(directory.categories)||!directory.categories.length||directory.categories.length>1000||!Array.isArray(directory.products)||!directory.products.length||directory.products.length>5000)invalid();
 const provenance=directory.provenance;
 if(!exact(provenance,['source','fetchedAt','sourceUrls','storeContext','acquisition'])||provenance.source!=='Starbucks website menu'||!string(provenance.fetchedAt,100)||!Number.isFinite(Date.parse(provenance.fetchedAt))||!same(provenance.sourceUrls,[MENU_DIRECTORY_SOURCE_URL])||provenance.storeContext!==null||!['fixture','live'].includes(provenance.acquisition))invalid();
 const categories=new Map();
 for(const category of directory.categories){
  if(!exact(category,['pathKey','id','name','parentPathKey','rootCategory','path','uri','displayOrder','imageURL','heroImageURL'])||!validPath(category.path)||category.pathKey!==pathKey(category.path)||categories.has(category.pathKey)||category.id!==category.path.at(-1).id||category.name!==category.path.at(-1).name||!same(category.rootCategory,category.path[0])||category.parentPathKey!==(category.path.length>1?pathKey(category.path.slice(0,-1)):null)||!uri(category.uri)||!order(category.displayOrder)||!image(category.imageURL)||!image(category.heroImageURL))invalid();
  if(category.parentPathKey!==null){const parent=categories.get(category.parentPathKey);if(!parent||!same(parent.path,category.path.slice(0,-1)))invalid();}
  categories.set(category.pathKey,category);
 }
 const identities=new Set();
 for(const product of directory.products){
  if(!product||typeof product!=='object'||Array.isArray(product))invalid();
  const keys=['identity','productNumber','formCode','name','description','imageURL','productType','defaultSize','sizes','availability','uri','categories',...(Object.hasOwn(product,'knownProductId')?['knownProductId']:[])];
  if(!exact(product,keys)||!/^\d{1,10}$/.test(product.productNumber)||!string(product.formCode,80)||!/^[A-Za-z][A-Za-z0-9-]*$/.test(product.formCode)||product.identity!==product.productNumber+':'+product.formCode||identities.has(product.identity)||!string(product.name)||!(product.description===null||string(product.description,20000,true))||!image(product.imageURL)||!string(product.productType,100)||!uri(product.uri)||!(product.availability===null||string(product.availability,100))||!Array.isArray(product.sizes)||!product.sizes.length||product.sizes.length>30||product.sizes.some(size=>!exact(size,['sizeCode'])||!string(size.sizeCode,100))||new Set(product.sizes.map(s=>s.sizeCode)).size!==product.sizes.length)invalid();
  if(product.defaultSize!==null&&(!exact(product.defaultSize,['sku','displayName'])||!string(product.defaultSize.sku,100)||!string(product.defaultSize.displayName,100,true)))invalid();
  if(Object.hasOwn(product,'knownProductId')&&(PRODUCT_IDS[product.productNumber]!==product.knownProductId||!['Hot','Iced'].includes(product.formCode)))invalid();
  if(!Array.isArray(product.categories)||!product.categories.length||product.categories.length>directory.categories.length||new Set(product.categories.map(c=>c.pathKey)).size!==product.categories.length)invalid();
  for(const membership of product.categories){if(!membership||typeof membership!=='object'||Array.isArray(membership))invalid();const category=categories.get(membership.pathKey);if(!exact(membership,['pathKey','path','rootCategory','displayOrder'])||!category||!same(membership.path,category.path)||!same(membership.rootCategory,category.rootCategory)||!order(membership.displayOrder))invalid();}
  identities.add(product.identity);
 }
 if(directory.version!==version(contentOf(directory)))invalid();
 return directory;
}
