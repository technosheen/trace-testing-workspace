import test from 'node:test';
import assert from 'node:assert/strict';
import {journey} from './journey.mjs';
import {verifyDiscoveredCase} from './verifier.mjs';
const spec={id:'url',name:'URL',kind:'journey',acceptance:'Expected URL',actions:[{action:'assertUrl',value:'/expected'}]};
test('healthy URL timeout is an independently reproducible assertion mismatch',async()=>{
 let calls=0;const result=await verifyDiscoveredCase(spec,{runAttempt:async()=>{calls++;return journey({waitForURL:async()=>{throw Object.assign(Error('Timeout'),{name:'TimeoutError'});},isClosed:()=>false,url:()=> 'https://example.com/actual'},spec,{url:'https://example.com/'});}});
 assert.equal(result.verdict,'issues_found');assert.equal(calls,2);
});
test('closed page and navigation errors remain blocked URL assertions',async()=>{
 for(const [closed,name,message] of [[true,'TimeoutError','Timeout'],[false,'Error','net::ERR_CONNECTION_RESET'],[false,'AbortError','Cancelled']]){
 const result=await journey({waitForURL:async()=>{throw Object.assign(Error(message),{name});},isClosed:()=>closed,url:()=> 'https://example.com/actual'},spec,{url:'https://example.com/'});
 assert.equal(result.status,'blocked');assert.equal(result.stepResults[0].failureKind,'tool_error');
 }
});
