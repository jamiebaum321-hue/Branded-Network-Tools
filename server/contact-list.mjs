import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const reader=fileURLToPath(new URL('./read_contact_list.py',import.meta.url));
export const listPurposes=['priority_targets','partnerships','team'];
let running=0;

export async function readContactList(file,config) {
  if(!listPurposes.includes(file.purpose)) return null;
  const extension=extname(file.name).toLowerCase();
  if(!['.csv','.xlsx'].includes(extension) || file.bytes.length>6*1024*1024)
    return {rows:[],note:'File attached. Automatic list entry supports CSV and XLSX files up to 6 MiB.'};
  if(running>=3) return {rows:[],note:'File attached. The list reader was busy. The team can review this file from the client record.'};
  running++;
  try {
    const parsed=await new Promise((resolve)=>{
      const child=spawn(config.pdfPython || (process.platform==='win32'?'python':'python3'),[reader,extension,file.purpose],{stdio:['pipe','pipe','ignore'],windowsHide:true});
      const chunks=[];
      let length=0;
      const timer=setTimeout(()=>child.kill(),8000);
      child.stdout.on('data',(chunk)=>{length+=chunk.length;if(length>3*1024*1024)child.kill();else chunks.push(chunk);});
      child.stdin.on('error',()=>{});
      child.on('error',()=>{});
      child.on('close',(code)=>{
        clearTimeout(timer);
        if(code===0) {
          try {return resolve(JSON.parse(Buffer.concat(chunks).toString()));} catch {}
        }
        resolve({rows:[]});
      });
      child.stdin.end(file.bytes);
    });
    return {rows:parsed.rows,note:parsed.rows.length ? parsed.rows.length+(parsed.rows.length===1?' row recognized.':' rows recognized.')+(parsed.limited?' Review the file for additional rows.':'') :
      'File attached. No rows recognized. Use column headers such as Company, Contact Name or First Name.'};
  } finally {running--;}
}
