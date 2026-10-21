import test from 'node:test';
import assert from 'node:assert/strict';
import {eventPeople,mapsLinks} from './eventDetail.ts';
import type {AgendaItem} from './agenda';
test('plan details include all people without duplicating the primary attendee',()=>{
 const a={contactId:'a',name:'Alex'};const b={contactId:'b',name:'Alex'};
 assert.deepEqual(eventPeople({withPerson:a,people:[a,b,{contactId:'c',name:null}]} as AgendaItem),[a,b]);
 assert.deepEqual(eventPeople(null),[]);
});
test('map location is encoded as data and directions remain separate',()=>{
 const links=mapsLinks('Cafe & Meeting? Room #2');
 assert.equal(new URL(links.map).searchParams.get('q'),'Cafe & Meeting? Room #2');
 assert.equal(new URL(links.directions).searchParams.get('daddr'),'Cafe & Meeting? Room #2');
});
