import { btn, field, h, hidden, icon } from './ui.mjs';

export function pipelineEditor({api,showDialog,render,notify}) {
  const path='/api/workspaces/solutions/stages';
  let columns=[],dragged=null,touch=null,busy=false;
  const rowFor=key=>columns.find(c=>c.id===key);
  const rows=()=>[...document.querySelectorAll('.stage-order [data-stage-row]')];
  const keyOf=row=>row.dataset.stageRow;
  async function open(focusId) {
    columns=(await api('/api/workspaces/solutions')).stages;
    showDialog('Edit pipeline stages',`<ol class="stage-order" aria-label="Pipeline stage order">${columns.map(c=>`
      <li class="stage-chip tone-${c.color}" draggable="true" data-stage-row="${h(c.id)}">
        <button type="button" class="stage-grip" aria-label="Reorder ${h(c.name)}" title="Drag to reorder, or use the up and down arrow keys">${icon('grip')}</button>
        <strong>${h(c.name)}</strong>
        ${btn('Rename',{action:'ws-rename-stage',data:`data-id="${h(c.id)}"`})}
        ${['outreach','signed'].includes(c.id)?'':btn('Delete',{action:'ws-remove-column',data:`data-id="${h(c.id)}"`})}</li>`).join('')}</ol>
        <form class="new-stage-inline" data-form="ws-add-column">${field('New stage name','name','',{max:55,required:true})}${btn('Add stage',{type:'submit',kind:'primary',glyph:'plus'})}</form>`);
    if(focusId) rows().find(r=>keyOf(r)===focusId)?.querySelector('.stage-grip').focus();
  }
  async function persist(key) {
    if(busy) return;
    const order=rows().map(keyOf),previous=columns.map(c=>c.id);
    if(!order.length || order.every((v,i)=>v===previous[i])) return;
    busy=true;
    try {
      await api(path+'/order','PUT',{order,previous});
      columns=order.map(rowFor);
      await render();
      notify('Stage order saved.');
    } catch(error){await open(key);notify(error.message);}
    finally{busy=false;}
  }
  function move(source,target){
    if(!source||!target||source===target||source.parentElement!==target.parentElement) return;
    const items=rows();
    target.parentElement.insertBefore(source,items.indexOf(source)<items.indexOf(target)?target.nextElementSibling:target);
  }
  document.addEventListener('dragstart',e=>{
    const row=e.target.closest('[data-stage-row]');
    if(!row || busy || e.target.closest('button:not(.stage-grip)')) return;
    dragged=row;dragged.classList.add('reordering');
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',keyOf(dragged));
    e.dataTransfer.setDragImage(dragged,18,18);
  });
  document.addEventListener('dragover',e=>{if(dragged && e.target.closest('.stage-order')) e.preventDefault();});
  document.addEventListener('drop',e=>{
    if(!dragged) return;
    const target=e.target.closest('[data-stage-row]');
    if(target){e.preventDefault();move(dragged,target);void persist(keyOf(dragged));}
    dragged.classList.remove('reordering');dragged=null;
  });
  document.addEventListener('dragend',()=>{dragged?.classList.remove('reordering');dragged=null;});
  document.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('.stage-grip')||e.target.closest('[data-stage-row]');
    if(e.pointerType==='mouse'||busy||!handle||e.target.closest('button:not(.stage-grip)')) return;
    touch=handle.closest('[data-stage-row]');
    handle.setPointerCapture(e.pointerId);touch.classList.add('reordering');e.preventDefault();
  });
  document.addEventListener('pointerup',e=>{
    if(!touch) return;
    const source=touch;touch=null;source.classList.remove('reordering');
    move(source,document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-stage-row]'));void persist(keyOf(source));
  });
  document.addEventListener('pointercancel',()=>{touch?.classList.remove('reordering');touch=null;});
  document.addEventListener('keydown',e=>{
    if(busy||!e.target.closest('.stage-grip')||!['ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const row=e.target.closest('[data-stage-row]'),other=e.key==='ArrowUp'?row.previousElementSibling:row.nextElementSibling;
    move(row,other);row.querySelector('.stage-grip').focus();void persist(keyOf(row));
  });
  return {actions:{
    'ws-columns':()=>open(),
    'ws-rename-stage':b=>{
      const stage=rowFor(b.dataset.id);
      showDialog('Rename stage',`<form class="stack" data-form="ws-rename-stage">${hidden('id',stage.id)}${hidden('previous',stage.name)}
        ${field('Stage name','name',stage.name,{required:true,max:55})}${btn('Save name',{type:'submit',kind:'primary'})}</form>`);
    },
  },forms:{
    async 'ws-add-column'(form,v){const c=await api(path,'POST',{name:v.get('name')});await render();await open(c.id);notify('Stage added.');},
    async 'ws-rename-stage'(form,v){const key=v.get('id');await api(path+'/'+key,'PATCH',{previous:v.get('previous'),name:v.get('name')});await render();await open(key);notify('Stage renamed.');},
  }};
}

let observer;
export function connectBoardScrollbar(previousLeft=0) {
  observer?.disconnect();
  const board=document.querySelector('.sales-board'),bar=document.querySelector('.board-scrollbar');
  if(!bar || !board) return;
  if(previousLeft) board.scrollLeft=previousLeft;
  const sync=()=>{bar.firstElementChild.style.width=board.scrollWidth+'px';bar.hidden=board.scrollWidth<=board.clientWidth+1;bar.scrollLeft=board.scrollLeft;};
  observer=new ResizeObserver(sync);observer.observe(board);sync();
  bar.onscroll=()=>{if(Math.abs(board.scrollLeft-bar.scrollLeft)>1) board.scrollLeft=bar.scrollLeft;};
  board.onscroll=()=>{if(Math.abs(board.scrollLeft-bar.scrollLeft)>1) bar.scrollLeft=board.scrollLeft;};
}
