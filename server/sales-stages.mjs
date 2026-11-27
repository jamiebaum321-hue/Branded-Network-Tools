import { AppError, audit, id, iso, requireAdmin } from './store.mjs';
import { list, object, str, validate } from './validation.mjs';

export function salesColumns(s) {
  return s.all('SELECT id,name,color FROM solution_sales_stages ORDER BY position,id');
}

function checkName(columns,name,except) {
  const reserved=['Nurture','Cold / nurture','Closed lost','Completed','Onboarding','Active advisory'];
  if([...reserved,...columns.filter(c=>c.id!==except).map(c=>c.name)].some(n=>n.toLowerCase()===name.toLowerCase()))
    throw new AppError(409,'Choose a distinct stage name.');
}
export function addSalesColumn(s,actor,input) {
  requireAdmin(actor);
  const {name,after}=validate(object({name:str(55),after:str(80)},['name']),input);
  return s.tx(()=>{
    const columns=salesColumns(s);
    checkName(columns,name);
    const anchor=after?s.get('SELECT position FROM solution_sales_stages WHERE id=?',after):null;
    if(after && !anchor) throw new AppError(409,'Refresh the stage list.');
    const position=anchor?anchor.position+1:s.get('SELECT max(position)+1 n FROM solution_sales_stages').n;
    s.run('UPDATE solution_sales_stages SET position=position+1 WHERE position>=?',position);
    const counts=Array.from({length:6},(_,i)=>columns.filter(c=>c.color===i).length);
    const color=counts.indexOf(Math.min(...counts)),key='sales_'+id();
    s.run('INSERT INTO solution_sales_stages(id,name,position,color) VALUES(?,?,?,?)',key,name,position,color);
    audit(s,actor,'sales.stage_created','sales_stage',key,null,{name});
    return {id:key,name,color};
  });
}

export function renameSalesColumn(s,actor,key,input) {
  requireAdmin(actor);
  const {name,previous}=validate(object({name:str(55),previous:str(55)}),input);
  return s.tx(()=>{
    const columns=salesColumns(s),stage=columns.find(c=>c.id===key);
    if(!stage) throw new AppError(404,'Stage not found.');
    if(stage.name!==previous && stage.name!==name) throw new AppError(409,'This stage was renamed. Reopen the editor.');
    checkName(columns,name,key);
    s.run('UPDATE solution_sales_stages SET name=? WHERE id=?',name,key);
    audit(s,actor,'sales.stage_renamed','sales_stage',key,null,{previous,name});
    return {id:key,name,color:stage.color};
  });
}

export function reorderSalesColumns(s,actor,input) {
  requireAdmin(actor);
  const ids=list(str(80),1000),{order,previous}=validate(object({order:ids,previous:ids}),input);
  return s.tx(()=>{
    const current=salesColumns(s).map(c=>c.id);
    if(order.length!==current.length || new Set(order).size!==current.length || order.some(k=>!current.includes(k)))
      throw new AppError(409,'The available stages changed. Reopen the editor.');
    if(JSON.stringify(current)===JSON.stringify(order)) return {ok:true};
    if(JSON.stringify(current)!==JSON.stringify(previous)) throw new AppError(409,'The stage order changed. Reopen the editor.');
    order.forEach((key,i)=>s.run('UPDATE solution_sales_stages SET position=? WHERE id=?',i,key));
    audit(s,actor,'sales.stages_reordered','sales_stage',null,null,{order});
    return {ok:true};
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
    const target=destination && destination!==key && destination!=='signed' && s.get('SELECT name FROM solution_sales_stages WHERE id=?',destination);
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
