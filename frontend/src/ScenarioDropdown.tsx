import {useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown} from 'lucide-react';

export type ScenarioOption={id:string;label:string;source?:string};

export function ScenarioDropdown({value,options,onChange,disabled=false}:{value:string;options:ScenarioOption[];onChange:(id:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false);const [active,setActive]=useState(0);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const listId=useId();
 const selectedIndex=Math.max(0,options.findIndex(o=>o.id===value));const selected=options[selectedIndex];
 useEffect(()=>{if(!open)return;setActive(selectedIndex);const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open,selectedIndex]);
 useEffect(()=>{if(!open)return;const el=root.current?.querySelector<HTMLButtonElement>(`[data-option-index="${active}"]`);el?.scrollIntoView({block:'nearest'})},[active,open]);
 function choose(index:number){const item=options[index];if(!item)return;onChange(item.id);setOpen(false);requestAnimationFrame(()=>trigger.current?.focus())}
 function keyDown(e:React.KeyboardEvent){if(disabled)return;if(!open&&['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();setOpen(true);setActive(selectedIndex);return}if(!open)return;if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus()}else if(e.key==='ArrowDown'){e.preventDefault();setActive(v=>Math.min(options.length-1,v+1))}else if(e.key==='ArrowUp'){e.preventDefault();setActive(v=>Math.max(0,v-1))}else if(e.key==='Home'){e.preventDefault();setActive(0)}else if(e.key==='End'){e.preventDefault();setActive(Math.max(0,options.length-1))}else if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(active)}else if(e.key==='Tab')setOpen(false)}
 return <div className={`scenario-dropdown ${open?'open':''}`} ref={root} onKeyDown={keyDown}>
  <button ref={trigger} type="button" className="scenario-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} disabled={disabled||!options.length} onClick={()=>setOpen(v=>!v)}>
   <span>{selected?`${selected.id} · ${selected.label}`:'No scenarios available'}</span><ChevronDown size={15}/>
  </button>
  <div className="scenario-popover" id={listId} role="listbox" aria-label="Active scenario">
   <div className="scenario-options">
    {options.map((option,index)=><button type="button" role="option" aria-selected={option.id===value} data-option-index={index} key={option.id} className={`${option.id===value?'selected':''} ${index===active?'active':''}`} onMouseEnter={()=>setActive(index)} onClick={()=>choose(index)}>
      <span><strong>{option.id}</strong><small>{option.label}</small></span>{option.id===value&&<Check size={15}/>} 
    </button>)}
   </div>
  </div>
 </div>
}
