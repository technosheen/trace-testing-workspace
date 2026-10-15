import { isDemo, safeNavigation, validateTarget } from './policy.mjs';
import { responseNetworkError } from './proxy.mjs';
function locator(page,target){return target.selector?page.locator(target.selector):page.getByRole(target.role,{name:target.name,exact:true});}
export async function journey(page,spec,inputs){
 const steps=[];let status='passed';
 for(let i=0;i<spec.actions.length;i++){
  const a=spec.actions[i];const start=Date.now();let failureKind='tool_error';
  try{
   const element=a.target?locator(page,a.target):null;
   if(a.action==='navigate'){
    const url=await validateTarget(new URL(a.url,inputs.url).href,isDemo(new URL(inputs.url)));
    if(!safeNavigation(url))throw Error('Navigation is outside the read-only policy.');
    const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:20000});
    const networkError=responseNetworkError(response);
    if(!response||networkError)throw Error(networkError?`Destination navigation was ${networkError} by the network guard.`:'No destination HTTP response was observed.');
    if(response.status()>=400){failureKind='http_error';throw Error(`Destination returned HTTP ${response.status()}.`);}
   }else if(a.action==='click')await element.click();
   else if(a.action==='hover')await element.hover();
   else if(a.action==='fill')await element.fill(a.value);
   else if(a.action==='select')await element.selectOption(a.value);
   else if(a.action==='scrollIntoView')await element.scrollIntoViewIfNeeded();
   else if(a.action==='assertVisible')await element.waitFor({state:'visible'});
   else if(a.action==='assertText'){
    await element.waitFor({state:'visible'});
    const deadline=Date.now()+10000;let found=false;
    do{if((await element.innerText()).includes(a.value)){found=true;break;}await page.waitForTimeout(100);}while(Date.now()<deadline);
    if(!found){failureKind='assertion_mismatch';status='issues_found';throw Error('Expected visible text was not found.');}
   }else if(a.action==='assertUrl'){
    const expected=new URL(a.value,inputs.url).href;
    try{await page.waitForURL(expected,{timeout:10000});}
    catch(error){
     // Only a healthy page that failed the URL expectation establishes a mismatch.
     // Network failures, closed pages and cancellation remain execution blockers.
     if(error.name==='TimeoutError'&&!page.isClosed()&&/^https?:/.test(page.url())&&page.url()!==expected&&!/net::|ERR_|closed|cancel|abort/i.test(error.message)){
      failureKind='assertion_mismatch';throw Error('Expected URL was not reached.');
     }
     throw error;
    }
   }
   steps.push({index:i+1,action:a.action,status:'passed',durationMs:Date.now()-start,summary:'Completed.'});
  }catch(error){
   status=['assertion_mismatch','http_error'].includes(failureKind)?'issues_found':'blocked';
   steps.push({index:i+1,action:a.action,status,failureKind,durationMs:Date.now()-start,summary:error.message.split('\n')[0]});
   for(let j=i+1;j<spec.actions.length;j++)steps.push({index:j+1,action:spec.actions[j].action,status:'not_run',summary:'Skipped after the preceding step failed.'});
   break;
  }
 }
 return {status,summary:status==='passed'?`All ${steps.length} journey steps passed.`:`Journey stopped at step ${steps.find(s=>!['passed','not_run'].includes(s.status))?.index}.`,details:steps.map(s=>`${s.index}. ${s.action}: ${s.status} — ${s.summary}`),stepResults:steps};
}
