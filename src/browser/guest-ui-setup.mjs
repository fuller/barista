/** Ordinary public UI actions only; selector drift/access denial leaves setup required. */
export async function setupGuestThroughUi(page,{stepTimeoutMs=8000,totalTimeoutMs=60000}={}){
 const deadline=Date.now()+totalTimeoutMs;
 const timeout=()=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('Guest setup timed out');return Math.min(stepTimeoutMs,remaining);};
 const click=async(role,name)=>{await page.getByRole(role,{name,exact:false}).first().click({timeout:timeout()});};
 const product='https://www.starbucks.com/menu/product/28516/iced';
 await page.goto(product,{waitUntil:'domcontentloaded',timeout:Math.min(15000,deadline-Date.now())});
 // Picking a cafe is required before the site can add a configured drink.
 await click('link',/For item availability Choose a caf[eé]/i);
 const search=page.getByRole('searchbox',{name:'Enter a location to search for Starbucks cafés',exact:true}).first();
 await search.fill('11201',{timeout:timeout()});await click('button','Submit search term');
 await page.getByRole('button',{name:'order here, 104 Jay St',exact:true}).click({timeout:timeout()});
 await page.goto(product,{waitUntil:'domcontentloaded',timeout:Math.min(15000,deadline-Date.now())});
 await click('button',/add to order/i);
 // Add-to-order normally initializes guest state. Review stays strictly price-only.
 await click('button',/^Open the cart\. There are \d+ items? in cart\./i);
}
