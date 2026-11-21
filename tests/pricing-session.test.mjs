import test from 'node:test';
import assert from 'node:assert/strict';
import {readExistingQuoteSession,getQuoteSession} from '../src/server/pricing-session.mjs';
const id='12345678-1234-4234-8234-123456789abc';
const request=cookie=>new Request('https://barista.example/api/config',{headers:cookie?{Cookie:cookie}:{}});
test('reading an absent or malformed session never creates a caller identifier',()=>{
 for(const cookie of [undefined,'','other=value','barista_quote=bad','barista_quote='+id+'; barista_quote='+id,'barista_quote=12345678-1234-1234-8234-123456789abc'])assert.equal(readExistingQuoteSession(request(cookie)),null);
});
test('read-only lookup preserves an existing valid caller without renewal',()=>{
 assert.equal(readExistingQuoteSession(request('other=value; barista_quote='+id)),id);
 assert.equal(getQuoteSession(request('barista_quote='+id)),id);
});
test('explicit allocation creates a fresh identifier only when no valid caller exists',()=>{
 const first=getQuoteSession(request()),second=getQuoteSession(request());
 assert.match(first,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(first,second);
});
