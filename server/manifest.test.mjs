import test from 'node:test';
import assert from 'node:assert/strict';
import {manifestSchema} from './manifest.mjs';
const doc=checks=>({schema:'trace/test/v2',policy:'read-only',name:'Journeys',checks});
const item=actions=>({kind:'journey',name:'Test',acceptance:'Expected outcome',actions});
test('journey manifests reject unsupported operations, missing assertions and ambiguous targets',()=>{
 for(const actions of [[{action:'evaluate',value:'fetch()'}],[{action:'click',target:{selector:'button'}}],[{action:'assertVisible',target:{selector:'h1',role:'heading',name:'Title'}}],[{action:'assertText',target:{selector:'h1'}}]]) assert.equal(manifestSchema.safeParse(doc([item(actions)])).success,false);
 assert.equal(manifestSchema.safeParse({...doc([item([{action:'assertUrl',value:'/'}])]),policy:'write'}).success,false);
 assert.equal(manifestSchema.safeParse(doc(Array(201).fill(item([{action:'assertUrl',value:'/'}])))).success,false);
 assert.equal(manifestSchema.safeParse(doc([item(Array(51).fill({action:'assertUrl',value:'/'}))])).success,false);
});
