import { AppError, clientFor, digest } from './store.mjs';
import { midnight } from './dashboard.mjs';
import { primaryEngagement } from './client-links.mjs';
import { reportEvidence } from './delivery.mjs';
import { todayKey, day } from './engagements.mjs';
import { sendFile } from './files.mjs';
import { weeklyReportFile } from './pdf.mjs';
import { milestoneStates, relationshipStages, healthStates } from '../public/solution-model.mjs';

function weeklyPreview(s,actor,client,query,zone) {
  const c=clientFor(s,actor,client);
  const end=day(query.get('end_day')||todayKey(zone));
  const start=day(query.get('start_day')||new Date(Date.parse(end)-6*86400000).toISOString().slice(0,10));
  const engagement=s.get(`SELECT (${primaryEngagement}) id FROM clients c WHERE c.id=?`,client).id;
  const evidence=reportEvidence(s,actor,engagement,{start_day:start,end_day:end},zone,true);
  const from=new Date(midnight(start,zone)).toISOString(),until=new Date(midnight(end,zone,1)).toISOString();
  const window=[client,from,until];
  const notes=s.all('SELECT author,body FROM client_notes WHERE client_id=? AND created_at>=? AND created_at<? ORDER BY created_at,id',...window)
    .map(r=>r.author+' · '+r.body);
  const milestones=s.all(`SELECT p.name project,t.name,m.status,m.notes,m.due FROM project_steps m JOIN delivery_stages t ON t.id=m.step
    JOIN delivery_projects p ON p.id=t.project_id WHERE m.client_id=? AND m.updated_at>=? AND m.updated_at<? ORDER BY m.updated_at,t.id`,...window)
    .map(r=>[r.project,r.name,milestoneStates[r.status],r.notes,r.due && 'Due '+r.due].filter(Boolean).join(' · '));
  const changes=s.all(`SELECT e.title deal,w.title FROM work_items w JOIN engagements e ON e.id=w.engagement_id
    WHERE e.client_id=? AND w.recorded_at>=? AND w.recorded_at<? AND w.kind='note' AND instr(w.title,' → ')>0 ORDER BY w.recorded_at,w.id`,...window)
    .map(r=>r.deal+' · '+r.title);
  const intake=s.all('SELECT version FROM submissions WHERE client_id=? AND submitted_at>=? AND submitted_at<? ORDER BY version',...window)
    .map(r=>'Client intake submitted · Version '+r.version);
  const files=s.all(`SELECT f.name,f.purpose FROM attachments f LEFT JOIN engagements e ON e.id=f.engagement_id
    WHERE (e.client_id=? OR (f.client_id=? AND f.submission_id IS NOT NULL)) AND f.created_at>=? AND f.created_at<? ORDER BY f.created_at,f.id`,client,...window)
    .map(r=>r.name+' · '+r.purpose);
  const connections=s.all(`SELECT n.company,n.person,n.health,n.stage,n.next_action FROM client_connections n
    WHERE n.client_id=? AND EXISTS(SELECT 1 FROM audit_log a WHERE a.client_id=n.client_id AND a.entity_id=n.node_key
    AND a.action='connection.saved' AND a.at>=? AND a.at<?) ORDER BY n.company,n.person`,...window)
    .map(r=>[r.company,r.person,healthStates[r.health],relationshipStages[r.stage],r.next_action].filter(Boolean).join(' · '));
  const brief=s.get(`SELECT b.goals,b.deliverables,(SELECT json_extract(answers,'$.priorities') FROM submissions WHERE client_id=c.id
    AND submitted_at<? ORDER BY version DESC LIMIT 1) priorities FROM clients c LEFT JOIN project_briefs b ON b.client_id=c.id WHERE c.id=?`,until,client);
  const priorities=[brief.goals || brief.priorities,brief.deliverables && 'Deliverables · '+brief.deliverables].filter(Boolean);
  const contactNotes=s.all(`SELECT a.body,p.company,p.person FROM activity a JOIN cards p ON p.id=a.card_id
    WHERE a.client_id=? AND a.occurred_at>=? AND a.occurred_at<? AND a.kind='note' ORDER BY a.occurred_at,a.seq`,...window)
    .map(r=>[r.company,r.person,r.body].filter(Boolean).join(' · '));
  const sections=[['Goals and deliverables',priorities],['Completed and outcomes',evidence.completed],['Outstanding work',evidence.outstanding],
    ['Introductions and next steps',evidence.introductions],['Connection updates',connections],['Project milestones',milestones],
    ['Client notes',[...notes,...contactNotes]],['Intake and files',[...intake,...files]],['Pipeline changes',changes]];
  const body=[c.name+' · Weekly update',start+' to '+end,...sections.map(([title,rows])=>title+'\n'+(rows.length?rows.map(v=>'• '+v).join('\n'):'No items recorded.'))].join('\n\n');
  return {client:c.name,start_day:start,end_day:end,sections:sections.map(([title,items])=>({title,items})),body,revision:digest(body)};
}
export function registerWeeklyView(route,s,config,root) {
  const path=root+'/weekly-update';
  route('GET',path,({actor,ids,url})=>{
    const preview=weeklyPreview(s,actor,ids[0],url.searchParams,config.timeZone);
    const saved=s.all(`SELECT r.id,r.start_day,r.end_day,r.body,r.version,r.engagement_id FROM report_versions r
      JOIN engagements e ON r.engagement_id=e.id WHERE e.client_id=? ORDER BY r.end_day DESC,r.created_at DESC,r.id`,ids[0]);
    return {...preview,saved};
  });
  route('GET',path+'/(pdf|xlsx)',async({actor,ids,url,res})=>{
    const report=weeklyPreview(s,actor,ids[0],url.searchParams,config.timeZone);
    if(url.searchParams.get('revision')!==report.revision) throw new AppError(409,'The weekly update changed. Refresh the preview before exporting.');
    const format=ids[1],bytes=await weeklyReportFile(report,report.client,format,config);
    const name=report.client.replace(/[^a-z0-9]+/gi,'-').slice(0,70)||'Client';
    sendFile(res,{name:name+'-weekly-update-'+report.end_day+'.'+format,
      mime:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes});
  });
}
