import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeMenuDirectory} from '../src/catalog/menu-directory.mjs';
import {createStarbucksWebsiteSource} from '../src/adapters/starbucks-website.mjs';

export async function syncMenuDirectory({source,menu,fetchedAt,acquisition='fixture',output=new URL('../src/catalog/data/starbucks-menu-directory.json',import.meta.url)}={}){
 if(source){menu=await source.loadMenu();fetchedAt=new Date().toISOString();acquisition='live';}
 const directory=normalizeMenuDirectory({menu,fetchedAt,acquisition});
 const target=output instanceof URL?fileURLToPath(output):output;
 if(typeof target!=='string')throw new Error('Invalid menu directory output');
 const temp=target+'.tmp-'+process.pid+'-'+Math.random().toString(16).slice(2);
 await fs.mkdir(path.dirname(target),{recursive:true});
 try{await fs.writeFile(temp,JSON.stringify(directory,null,2)+'\n',{flag:'wx'});await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
 return directory;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const live=process.argv.includes('--live');let options;
 if(live)options={source:createStarbucksWebsiteSource()};
 else{const read=async name=>JSON.parse(await fs.readFile(new URL('../tests/fixtures/starbucks/'+name,import.meta.url),'utf8'));const provenance=await read('provenance.json');options={menu:await read('menu.json'),fetchedAt:provenance.fetchedAt,acquisition:'fixture'};}
 const directory=await syncMenuDirectory(options);
 console.log(JSON.stringify({version:directory.version,categories:directory.categories.length,products:directory.products.length,photos:directory.products.filter(p=>p.imageURL).length,acquisition:directory.provenance.acquisition}));
}
