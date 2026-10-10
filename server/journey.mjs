import { isDemo, safeNavigation, validateTarget } from './policy.mjs';
function locator(page,target){return target.selector?page.locator(target.selector):page.getByRole(target.role,{name:target.name,exact:true});}
export async function journey(page,spec,inputs){
 const steps=[];let status='passed';
 for(let i=0;i<spec.actions.length;i++){
  const a=spec.actions[i];const start=Date.now();
  try{
   const element=a.target?locator(page,a.target):null;
   if(a.action==='navigate'){
    const url=await validateTarget(new URL(a.url,inputs.url).href,isDemo(new URL(inputs.url)));
    if(!safeNavigation(url))throw Error('Navigation is outside the read-only policy.');
    const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:20000});
    if(!response||response.status()>=400)throw Error('Destination returned an unsuccessful response.');
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
    if(!found){status='issues_found';throw Error('Expected visible text was not found.');}
   }else if(a.action==='assertUrl'){
    await page.waitForURL(new URL(a.value,inputs.url).href,{timeout:10000});
   }
   steps.push({index:i+1,action:a.action,status:'passed',durationMs:Date.now()-start,summary:'Completed.'});
  }catch(error){
   if(a.action.startsWith('assert')&&!/strict mode|closed|cancel/i.test(error.message))status='issues_found';
   else if(status==='passed')status='blocked';
   steps.push({index:i+1,action:a.action,status,durationMs:Date.now()-start,summary:error.message.split('\n')[0]});
   for(let j=i+1;j<spec.actions.length;j++)steps.push({index:j+1,action:spec.actions[j].action,status:'not_run',summary:'Skipped after the preceding step failed.'});
   break;
  }
 }
 return {status,summary:status==='passed'?`All ${steps.length} journey steps passed.`:`Journey stopped at step ${steps.find(s=>!['passed','not_run'].includes(s.status))?.index}.`,details:steps.map(s=>`${s.index}. ${s.action}: ${s.status} — ${s.summary}`),stepResults:steps};
}
