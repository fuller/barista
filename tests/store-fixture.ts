import type {Browser} from '@e2e-dev/web';
import type {Screen} from 'e2e';
export {fixtureStores} from './store-fixture-data.mjs';
import {fixtureStores} from './store-fixture-data.mjs';
export async function installStoreFixture(browser:Browser){await browser.route('**/api/stores?*',route=>route.fulfill({json:{stores:fixtureStores}}));}
export async function chooseStore(screen:Screen){await screen.getByRole('button',{name:'Search stores',exact:true}).click();await screen.getByRole('radio').first().click();await screen.getByRole('button',{name:'Use this store',exact:true}).click();}
