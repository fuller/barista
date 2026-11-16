import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeMenuDirectory,validateMenuDirectory} from '../src/catalog/menu-directory.mjs';
import {syncMenuDirectory} from '../scripts/sync-menu-directory.mjs';
const menu=JSON.parse(await fs.readFile(new URL('./fixtures/starbucks/menu.json',import.meta.url),'utf8'));
const provenance=JSON.parse(await fs.readFile(new URL('./fixtures/starbucks/provenance.json',import.meta.url),'utf8'));
const options={menu,fetchedAt:provenance.fetchedAt};
const normalize=(data=menu,extra={})=>normalizeMenuDirectory({...options,menu:data,...extra});
const sampleProduct=()=>({productNumber:407,formCode:'Hot',name:'Caffè Latte',productType:'Beverage',defaultSize:{sku:'123',displayName:'Grande'},sizes:[{sizeCode:'Grande'}],availability:'Available',imageURL:'https://cloudassets.starbucks.com/is/image/sbuxcorp/Latte',uri:'/product/407/hot',displayOrder:1});
const simple=()=>({menus:[{id:'coffee',name:'Coffee',uri:'/coffee',displayOrder:1,categoryImageURL:null,heroCategoryImageURL:null,products:[sampleProduct()],children:[]}]});
test('entire frozen public menu retains 313 unique listings and all category paths/photos',()=>{
 const directory=normalize();assert.equal(directory.products.length,313);assert.equal(directory.categories.length,105);assert.equal(directory.products.filter(p=>p.imageURL).length,313);
 assert.deepEqual(directory.categories.filter(c=>c.parentPathKey===null).map(c=>c.name),menu.menus.map(c=>c.name));
 assert.equal(new Set(directory.categories.map(c=>c.pathKey)).size,105);assert.ok(new Set(directory.categories.map(c=>c.id)).size<105);
 assert.deepEqual(Object.fromEntries(['Beverage','Food','Coffee'].map(type=>[type,directory.products.filter(p=>p.productType===type).length])),{Beverage:207,Food:82,Coffee:24});
 assert.deepEqual(new Set(directory.products.map(p=>p.formCode)),new Set(['Iced','Hot','Single','Packaged','Whole-Bean','VIA']));assert.equal(validateMenuDirectory(directory),directory);
});
test('duplicate source identities merge all full category memberships',()=>{
 const fixture=simple();fixture.menus.push({...fixture.menus[0],id:'featured',name:'Featured'});const d=normalize(fixture);assert.equal(d.products.length,1);assert.deepEqual(d.products[0].categories.map(c=>c.rootCategory.name),['Coffee','Featured']);assert.deepEqual(d.products[0].categories[0].path,[{id:'coffee',name:'Coffee'}]);
});
test('exact source facts retained without fabricated description, money or orderability',()=>{
 const d=normalize(simple());const p=d.products[0];assert.equal(p.name,'Caffè Latte');assert.equal(p.description,null);assert.equal(p.imageURL,sampleProduct().imageURL);assert.deepEqual(p.defaultSize,sampleProduct().defaultSize);assert.deepEqual(p.sizes,sampleProduct().sizes);assert.equal(p.knownProductId,'latte');
 for(const key of ['price','priceCents','recipe','defaults','orderable','supported','temperature'])assert.equal(Object.hasOwn(p,key),false);
});
test('listed description preserved and unmapped forms need no recipe profile',()=>{
 const fixture=simple();fixture.menus[0].products[0]={...sampleProduct(),productNumber:999999,formCode:'Packaged',productType:'Food',description:'Exact source description.'};const p=normalize(fixture).products[0];assert.equal(p.description,'Exact source description.');assert.equal(p.knownProductId,undefined);assert.equal(p.formCode,'Packaged');
});
test('content version ignores acquisition time but changes with source facts',()=>{
 const first=normalize(simple()),second=normalize(simple(),{fetchedAt:'2026-11-15T00:00:00Z',acquisition:'live'});assert.equal(first.version,second.version);const changed=simple();changed.menus[0].products[0].name='Changed source name';assert.notEqual(normalize(changed).version,first.version);
});
test('conflicting repeated identity facts rejected instead of guessed',()=>{const fixture=simple();fixture.menus.push({...fixture.menus[0],id:'featured',products:[{...sampleProduct(),name:'Different name'}]});assert.throws(()=>normalize(fixture),/Invalid menu directory/);});
for(const mutate of [f=>{f.menus[0].products[0].imageURL='https://evil.example/photo';},f=>{f.menus[0].products[0].sizes='Grande';},f=>{f.menus[0].children={};},f=>{f.menus[0].products[0].productNumber='x';}])test('invalid source rejects complete snapshot',()=>{const fixture=simple();mutate(fixture);assert.throws(()=>normalize(fixture),/Invalid menu directory/);});
test('validator rejects fact tampering, invalid references and extra unsafe fields',()=>{
 for(const mutate of [d=>{d.products[0].name='tampered';},d=>{d.products[0].priceCents=1;},d=>{d.products[0].categories[0].pathKey='missing';},d=>{d.products[0].knownProductId='mocha';},d=>{d.provenance.sourceUrls=['https://evil.example'];}]){const d=normalize(simple());mutate(d);assert.throws(()=>validateMenuDirectory(d),/Invalid menu directory/);}
});
test('refresh uses one logical menu read, no product details and writes validated snapshot',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'barista-directory-'));const output=path.join(dir,'menu.json');let calls=0;
 try{const d=await syncMenuDirectory({source:{loadMenu:async()=>{calls++;return simple();},loadProduct:()=>assert.fail('no detail calls')},output});assert.equal(calls,1);assert.equal(d.provenance.acquisition,'live');assert.equal(JSON.parse(await fs.readFile(output,'utf8')).version,d.version);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('invalid refresh preserves last good bytes and leaves no temporary files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'barista-directory-'));const output=path.join(dir,'menu.json');
 try{await syncMenuDirectory({...options,menu:simple(),output});const before=await fs.readFile(output,'utf8');await assert.rejects(()=>syncMenuDirectory({...options,menu:{menus:[]},output}),/Invalid menu directory/);assert.equal(await fs.readFile(output,'utf8'),before);assert.deepEqual(await fs.readdir(dir),['menu.json']);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
