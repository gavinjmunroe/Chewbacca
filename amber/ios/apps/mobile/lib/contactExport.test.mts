import test from 'node:test';
import assert from 'node:assert/strict';
import {sameApplePerson,appleContactFields,deviceContactDetails,contactDetailRows,phoneKey,linkedinKey} from './contactExport.ts';
test('Apple export never merges on name alone and preserves existing labels',()=>{
 assert.equal(sameApplePerson({name:'Jonah Graham'},{name:'Jonah Graham'}),false);
 const card={emails:[{email:'person@example.com',label:'work'}],phoneNumbers:[{number:'+1 (202) 555-0100',label:'home'}],urlAddresses:[{url:'https://example.com',label:'website'}]};
 const p={name:'Example',workEmail:'PERSON@example.com',phone:'+12025550100',linkedin:'https://linkedin.com/in/example'};
 assert.equal(sameApplePerson(card,p),true);
 const fields=appleContactFields(p,card);assert.equal(fields.emails.length,1);assert.equal(fields.phoneNumbers.length,1);assert.equal(fields.phoneNumbers[0].label,'home');assert.equal(fields.urlAddresses.length,2);
 assert.deepEqual(appleContactFields(p,fields),fields);
});

test('phone normalization keeps countries distinct and joins US local formats',()=>{
 assert.equal(phoneKey('2025550100'),phoneKey('+1 (202) 555-0100'));
 assert.notEqual(phoneKey('+33612345678'),phoneKey('+13612345678'));
 assert.equal(phoneKey('0033612345678'),phoneKey('+33612345678'));
});
test('LinkedIn variants match but unsafe hosts and name-only matches do not',()=>{
 assert.equal(linkedinKey('https://www.linkedin.com/in/example/?trk=test'),linkedinKey('https://linkedin.com/in/example'));
 assert.equal(linkedinKey('https://linkedin.com.evil.example/in/example'),'');
 assert.equal(sameApplePerson({name:'Example Person'},{name:'Example Person'}),false);
 assert.equal(sameApplePerson({name:'Example Person',urlAddresses:[{label:'LinkedIn',url:'https://www.linkedin.com/in/example/?trk=x'}]},{name:'Example',linkedin:'https://linkedin.com/in/example'}),true);
});
test('imported labels populate four enrichment fields and display each value once',()=>{
 const details=deviceContactDetails({name:'Example',emails:[{label:'work',email:'work@example.com'},{label:'home',email:'home@example.com'}],phoneNumbers:[{label:'iPhone',number:'2025550100'}],urlAddresses:[{label:'profile',url:'https://linkedin.com/in/example'}]});
 assert.equal(details.workEmail,'work@example.com');assert.equal(details.personalEmail,'home@example.com');assert.equal(details.phone,'2025550100');assert.equal(contactDetailRows(details).length,4);
 const fields=appleContactFields({...details,workEmail:' WORK@example.com ',phone:'+12025550100'},{emails:[{label:'work',email:'work@example.com'}],phoneNumbers:[{label:'iPhone',number:'2025550100'}]});
 assert.equal(fields.emails.length,2);assert.equal(fields.phoneNumbers.length,1);assert.equal(fields.phoneNumbers[0].label,'iPhone');
});
