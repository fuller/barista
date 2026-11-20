import {expect,test} from 'e2e';
import {fixtureStores} from './store-fixture';
import type {Browser} from '@e2e-dev/web';

type GeoTest={calls:number;options?:PositionOptions;success:(value:unknown)=>void;failure:(value:unknown)=>void};
declare global {interface Window {storeGeo:GeoTest}}
async function installLocation(browser:Browser){
 await browser.addInitScript(()=>{const state={calls:0,success:(_value:unknown)=>{},failure:(_value:unknown)=>{}} as GeoTest;window.storeGeo=state;Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success:GeoTest['success'],failure:GeoTest['failure'],options:PositionOptions){state.calls++;state.success=success;state.failure=failure;state.options=options;}}});});
}

test('nearby store search asks location only after click and requires explicit store confirmation',async({app,screen,browser})=>{
 await installLocation(browser);const requests:string[]=[];
 await browser.route('**/api/stores?*',route=>{requests.push(route.request.url);return route.fulfill({json:{stores:fixtureStores}});});
 await app.open('/');expect(await browser.evaluate(()=>window.storeGeo.calls)).toBe(0);await app.screenshot('use-my-location-desktop');
 await screen.getByRole('button',{name:'Use my location',exact:true}).click();
 expect(await browser.evaluate(()=>window.storeGeo.calls)).toBe(1);
 expect(await browser.evaluate(()=>window.storeGeo.options)).toEqual({enableHighAccuracy:false,timeout:10000,maximumAge:60000});
 await browser.evaluate(()=>window.storeGeo.success({coords:{latitude:40.7,longitude:-73.98}}));
 await expect(screen.getByRole('radio').first()).toBeVisible();
 expect(requests.length).toBe(1);const url=new URL(requests[0]);expect(url.searchParams.get('lat')).toBe('40.7');expect(url.searchParams.get('lng')).toBe('-73.98');expect(url.searchParams.has('q')).toBe(false);
 await expect(screen.getByRole('button',{name:'Use this store',exact:true})).toBeDisabled();await expect(screen.getByRole('region',{name:'Full menu'})).toHaveCount(0);
 await screen.getByRole('radio').first().click();await screen.getByRole('button',{name:'Use this store',exact:true}).click();await expect(screen.getByRole('region',{name:'Full menu'})).toBeVisible();
});

for(const [name,code] of [['permission denied',1],['unavailable',2],['timeout',3]] as const)test(`location ${name} leaves manual ZIP search usable`,async({app,screen,browser})=>{
 await installLocation(browser);await browser.route('**/api/stores?*',route=>route.fulfill({json:{stores:fixtureStores}}));await app.open('/');
 await screen.getByRole('button',{name:'Use my location',exact:true}).click();await browser.evaluate(code=>window.storeGeo.failure({code}),code);
 await expect(screen.getByRole('alert')).toBeVisible();await expect(screen.getByRole('alert')).toContainText(/location/i);
 await screen.getByLabel('ZIP code or city').fill('10001');await screen.getByRole('button',{name:'Search stores',exact:true}).click();await expect(screen.getByRole('radio').first()).toBeVisible();
});

test('late location callback cannot replace a newer manual store search',async({app,screen,browser})=>{
 await installLocation(browser);const queries:string[]=[];await browser.route('**/api/stores?*',route=>{const url=new URL(route.request.url);queries.push(url.searchParams.get('q')??'coordinates');return route.fulfill({json:{stores:url.searchParams.has('q')?[fixtureStores[1]]:[fixtureStores[0]]}});});
 await app.open('/');await screen.getByRole('button',{name:'Use my location',exact:true}).click();await screen.getByLabel('ZIP code or city').fill('Brooklyn');await screen.getByRole('button',{name:'Search stores',exact:true}).click();await expect(screen.getByRole('radio',{name:/6 Metro Tech at Jay Street/})).toBeVisible();
 await browser.evaluate(()=>window.storeGeo.success({coords:{latitude:40.7,longitude:-73.98}}));
 await expect(screen.getByRole('radio',{name:/104 Jay St/})).toHaveCount(0);expect(queries).toEqual(['Brooklyn']);
});

test('unsupported browser location explains manual search fallback',async({app,screen,browser})=>{
 await browser.setViewport({width:390,height:844});await browser.addInitScript(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});});await browser.route('**/api/stores?*',route=>route.fulfill({json:{stores:fixtureStores}}));await app.open('/');
 await screen.getByRole('button',{name:'Use my location',exact:true}).click();await expect(screen.getByRole('alert')).toContainText(/location/i);await app.screenshot('use-my-location-mobile');await screen.getByLabel('ZIP code or city').fill('11201');await screen.getByRole('button',{name:'Search stores',exact:true}).click();await expect(screen.getByRole('radio').first()).toBeVisible();
});
