import test from 'node:test';import assert from 'node:assert/strict';import {amberCardPath} from './cardImportUrl.ts';
const base='https://amber.example',token='a'.repeat(32);
test('only exact Amber origins and public card tokens can enter the account client',()=>{assert.equal(amberCardPath(base+'/card/'+token,base),token);for(const url of ['https://evil.test/card/'+token,'http://amber.example/card/'+token,'https://user:pass@amber.example/card/'+token,base+'/card/bad',base+'/v1/me'])assert.equal(amberCardPath(url,base),null);});
