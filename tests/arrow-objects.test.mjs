import test from 'node:test';
import assert from 'node:assert/strict';
import {canDeletePair} from '../cloudflare/arrow-objects.js';
test('direct deletion requires an exact unambiguous pair and never guesses a legacy return',()=>{
 const a={id:'a',links:[{target:'b',pairId:'one'},{target:'b',pairId:'two'}]},b={id:'b',links:[{target:'a',pairId:'one'},{target:'a',pairId:'two'}]},t={rooms:[a,b]};
 assert.equal(canDeletePair(t,a,a.links[0]),true);
 b.links[0].target='elsewhere';assert.equal(canDeletePair(t,a,a.links[0]),false);
 b.links[0].target='a';b.links.push({...b.links[0]});assert.equal(canDeletePair(t,a,a.links[0]),false);b.links.pop();
 delete a.links[0].pairId;assert.equal(canDeletePair(t,a,a.links[0]),false);a.links[0].pairId='one';
 b.links.shift();assert.equal(canDeletePair(t,a,a.links[0]),true);
 a.links.pop();assert.equal(canDeletePair(t,a,a.links[0]),false);
 b.links=[];assert.equal(canDeletePair(t,a,a.links[0]),true);
 a.links.push({...a.links[0]});assert.equal(canDeletePair(t,a,a.links[0]),false);
});
