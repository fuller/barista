import {validateSelectedStore} from './selected-store.mjs';
/** Ordinary public UI actions only; selector drift/access denial leaves setup required. */
export async function setupGuestThroughUi(page,{selectedStore,stepTimeoutMs=8000,totalTimeoutMs=60000}={}){
 const store=validateSelectedStore(selectedStore,selectedStore?.sourceStoreNumber);
 const deadline=Date.now()+totalTimeoutMs;
 const timeout=()=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('Guest setup timed out');return Math.min(stepTimeoutMs,remaining);};
 const click=async(role,name)=>{await page.getByRole(role,{name,exact:false}).first().click({timeout:timeout()});};
 const product='https://www.starbucks.com/menu/product/28516/iced';
 await page.goto(product,{waitUntil:'domcontentloaded',timeout:Math.min(15000,deadline-Date.now())});
 // Picking a cafe is required before the site can add a configured drink.
 await click('link',/For item availability Choose a caf[eé]/i);
 const search=page.getByRole('searchbox',{name:'Enter a location to search for Starbucks cafés',exact:true}).first();
 await search.fill(store.address.postalCode,{timeout:timeout()});await click('button','Submit search term');
 // The provider store number in the details link disambiguates same-name cafes.
 const link=page.locator(`a[data-e2e="cardLink"][href^="/stores/${encodeURIComponent(store.sourceStoreNumber)}/"]`);
 const row=page.locator('article').filter({has:link});
 const card=row.locator('[data-e2e="cardButton"]');
 if(await card.isEnabled({timeout:timeout()}))await card.click({timeout:timeout()});
 await row.locator('[data-e2e="confirmStoreButton"]').click({timeout:timeout()});
 await page.goto(product,{waitUntil:'domcontentloaded',timeout:Math.min(15000,deadline-Date.now())});
 await click('button',/add to order/i);
 // Add-to-order normally initializes guest state. Review stays strictly price-only.
 await click('button',/^Open the cart\. There are \d+ items? in cart\./i);
}
