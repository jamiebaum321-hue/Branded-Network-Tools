import { clientFor } from './store.mjs';
import { checkLine, todayKey } from './engagements.mjs';
import { clientWorkspace, saveClientNote, saveConnection, savePerson } from './solution-clients.mjs';
import { projectGrid, saveBrief, saveStep } from './solution-projects.mjs';

export function registerSolutionRoutes(route,s,config) {
  const root='/api/clients/([\\w-]{1,80})';
  route('GET','/api/projects',({actor,url})=>{
    checkLine(s,actor,'solutions');
    const month=url.searchParams.get('month') || todayKey(config.timeZone).slice(0,7);
    return {month,projects:projectGrid(s,actor,month)};
  });
  route('GET',root+'/workspace',({actor,ids})=>clientWorkspace(s,actor,ids[0]));
  route('GET',root+'/project',({actor,ids,url})=>projectGrid(s,actor,url.searchParams.get('month') || todayKey(config.timeZone).slice(0,7),ids[0])[0]);
  route('PUT',root+'/project',({actor,ids,data})=>saveBrief(s,actor,ids[0],data));
  for (const [method,path,write] of [
    ['POST','notes',saveClientNote],['PUT','connections',saveConnection],
    ['PUT','people',savePerson],['PUT','milestones',saveStep],
  ]) route(method,root+'/'+path,({actor,ids,data})=>{
    clientFor(s,actor,ids[0]);
    return write(s,actor,{...data,client_id:ids[0]});
  });
}
