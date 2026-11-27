import { AppError, audit, id, iso, requireAdmin } from './store.mjs';
import { object, str, validate } from './validation.mjs';

export function salesColumns(s) {
  return [...s.all('SELECT id,name FROM solution_sales_stages ORDER BY position,id'),{id:'signed',name:'Signed'}];
}

export function addSalesColumn(s,actor,input) {
  requireAdmin(actor);
  const {name,after}=validate(object({name:str(55),after:str(80)},['name']),input);
  return s.tx(()=>{
    const columns=salesColumns(s).slice(0,-1);
    if (['Signed','Nurture','Cold / nurture','Closed lost','Completed','Onboarding','Active advisory',...columns.map(c=>c.name)].some(n=>n.toLowerCase()===name.toLowerCase()))
      throw new AppError(409,'Choose a distinct stage name.');
    const index=after?columns.findIndex(c=>c.id===after):columns.length-1;
    if(index<0) throw new AppError(409,'The preceding stage changed. Reopen the stage editor.');
    const key='sales_'+id();
    const {position}=s.get('SELECT position FROM solution_sales_stages WHERE id=?',columns[index].id);
    s.run('UPDATE solution_sales_stages SET position=position+1 WHERE position>?',position);
    s.run('INSERT INTO solution_sales_stages VALUES(?,?,?)',key,name,position+1);
    audit(s,actor,'sales.stage_created','sales_stage',key,null,{name});
    return {id:key,name};
  });
}

export function removeSalesColumn(s,actor,key,input) {
  requireAdmin(actor);
  const {destination}=validate(object({destination:str(80)},[]),input);
  if(key==='outreach'||key==='signed') throw new AppError(400,'Outreach and Signed are required by the sales workflow.');
  return s.tx(()=>{
    const stage=s.get('SELECT name FROM solution_sales_stages WHERE id=?',key);
    if(!stage) throw new AppError(404,'Stage not found.');
    const deals=s.all("SELECT id FROM engagements WHERE line='solutions' AND stage=?",key);
    const target=destination && destination!==key && s.get('SELECT name FROM solution_sales_stages WHERE id=?',destination);
    if((deals.length || destination) && !target) throw new AppError(409,'Choose an open stage for the remaining engagements.');
    const at=iso();
    for(const deal of deals) {
      s.run('UPDATE engagements SET stage=?,version=version+1,updated_at=? WHERE id=?',destination,at,deal.id);
      s.run("INSERT INTO work_items(id,engagement_id,kind,title,status,recorded_at,actor) VALUES(?,?,'note',?,'done',?,?)",
        id(),deal.id,stage.name+' → '+target.name,at,actor.name);
    }
    s.run('DELETE FROM solution_sales_stages WHERE id=?',key);
    audit(s,actor,'sales.stage_removed','sales_stage',key,null,{name:stage.name,destination:destination || null,moved:deals.length});
    return {moved:deals.length};
  });
}
