import {chooseStore} from './store-fixture';
import { beforeEach, expect, test } from 'e2e';
import {quoteOrder} from '../src/domain/pricing.mjs';
import type {Order} from '../src/contracts';

beforeEach(async({browser})=>{
 await browser.route('**/api/config',route=>route.fulfill({json:{liveAvailable:true,provider:'test-fixture',model:'deterministic-test-only',pricing:{available:true}}}));
 await browser.route('**/api/quote',route=>{
  const {order,storeId}=JSON.parse(route.request.postData??'{}') as {order:Order;storeId:string};
  const quote=quoteOrder(order);
  return route.fulfill({json:{...quote,revision:order.revision,source:'starbucks',estimated:false,storeId,storeNumber:'85278-313836',expiresAt:Date.now()+60000,taxCents:0}});
 });
});

test('orders a drink, edits a modifier, and updates sample pricing', async ({ app, screen }) => {
  await app.open('/');await chooseStore(screen);

  await screen.getByRole('textbox', { name: 'Tell us your order' }).fill('a grande iced latte with oat milk');
  await screen.getByRole('button', { name: 'Send order' }).click();

  const order = screen.getByRole('complementary', { name: 'Your order' });
  await expect(order.getByRole('heading', { name: 'Caffè Latte' })).toBeVisible();
  await expect(order.getByText('grande · iced · oat', { exact: true })).toBeVisible();
  await expect(order.getByText('$5.25', { exact: true }).first()).toBeVisible();

  await order.getByText(/^Customize\s*\+$/).click();
  await screen.getByLabel('shots').fill('3');
 await order.getByRole('heading').first().click();

  await expect(order.getByText('$6.50', { exact: true }).first()).toBeVisible();
  await expect(order.getByText('Subtotal', { exact: true })).toBeVisible();
});

test('edits, duplicates, undoes, and preserves the cart after a contradiction', async ({ app, screen }) => {
  await app.open('/');await chooseStore(screen);
  const input = screen.getByRole('textbox', { name: 'Tell us your order' });
  const send = screen.getByRole('button', { name: 'Send order' });
  const order = screen.getByRole('complementary', { name: 'Your order' });
  const submitTurn = async (text: string) => {
    await input.fill(text);
    await send.click();
  };

  await submitTurn('a grande iced latte with oat milk');
  await expect(order.getByText('$5.25', { exact: true }).first()).toBeVisible();

  await submitTurn('Make it venti');
  await expect(order.getByText('venti · iced · oat', { exact: true })).toBeVisible();
  await expect(order.getByText('$5.75', { exact: true }).first()).toBeVisible();

  await submitTurn('Add another but hot');
  await expect(order.getByText('2 drinks', { exact: true })).toBeVisible();
  await expect(order.getByText('$11.50', { exact: true }).first()).toBeVisible();

  await submitTurn('undo');
  await expect(order.getByText('1 drink', { exact: true })).toBeVisible();
  await expect(order.getByText('$5.75', { exact: true }).first()).toBeVisible();

  await submitTurn('a latte or mocha');
  await expect(screen.getByText('Please request one drink or one clear change at a time.', { exact: true })).toBeVisible();
  await expect(order.getByText('1 drink', { exact: true })).toBeVisible();
  await expect(order.getByText('$5.75', { exact: true }).first()).toBeVisible();
});

test('keeps live ordering accessible on mobile and preserves default mocha pumps on resize', async ({ app, screen, browser }) => {
  await app.open('/');await chooseStore(screen);
  await browser.setViewport({ width: 390, height: 844 });
  await expect(screen.getByRole('textbox',{name:'Tell us your order'})).toBeVisible();
  await expect(screen.getByLabel('Interpreter')).toHaveCount(0);

  await screen.getByRole('textbox',{name:'Tell us your order'}).fill('a mocha');
  await screen.getByRole('button',{name:'Send order'}).click();
  await screen.getByRole('button',{name:/View order/}).click();
  const order = screen.getByRole('complementary', { name: 'Your order' });
  await expect(order.getByText('$5.75', { exact: true }).first()).toBeVisible();
  await screen.getByText(/^Customize\s*\+$/).click();
  await screen.getByLabel('size').selectOption('venti');

  await expect(screen.getByLabel('mocha pump')).toHaveValue('5');
  await expect(order.getByText('$6.25', { exact: true }).first()).toBeVisible();
});
