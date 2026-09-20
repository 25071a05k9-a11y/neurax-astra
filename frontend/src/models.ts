import {facilities} from './data';
export type Architecture='linear'|'converging'|'parallel';
export type Facility={id:number;name:string;subtitle:string;stations:string[];rate:number;wip:number;yield:number;util:number[];architecture?:Architecture};
export const architectureNames:Record<Architecture,string>={linear:'Sequential line',converging:'Converging streams',parallel:'Parallel cells'};
export function initialModel(){try{const id=Number(localStorage.getItem('astra-active-model-v1'));return facilities.some(f=>f.id===id)?id:1}catch{return 1}}
export function architectureOf(f:Facility):Architecture{return f.architecture||(f.id===2?'converging':f.id===3?'parallel':'linear')}
