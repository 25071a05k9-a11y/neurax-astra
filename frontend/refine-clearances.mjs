import fs from 'node:fs';
const file='C:/NURAX/astra-showcase/src/FactoryScene.tsx';let s=fs.readFileSync(file,'utf8');
function edit(a,b){if(!s.includes(a))throw new Error('Missing edit '+a.slice(0,80));s=s.replaceAll(a,b)}
edit("import {OrbitControls}", "import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';\nimport {OrbitControls}");
edit("const labels=useRef<(HTMLButtonElement|null)[]>([]);", "const labels=useRef<(HTMLButtonElement|null)[]>([]);const leaders=useRef<(SVGPathElement|null)[]>([]);const leaderDots=useRef<(SVGCircleElement|null)[]>([]);");
edit("new THREE.BoxGeometry(w,h,d)", "w>1&&h>.5&&d>.3?new RoundedBoxGeometry(w,h,d,2,.035):new THREE.BoxGeometry(w,h,d)");
edit("box(group,.52,.18,.48,-.15,.48,.58,graphite);box(group,.55,.05,.51,-.15,.59,.58,metal)", "box(group,.52,.18,.48,-.28,.48,.7,graphite);box(group,.55,.05,.51,-.28,.59,.7,metal)");
edit("box(group,.17,.12,.16,-.15,.69,.58,silver)", "box(group,.17,.12,.16,-.28,.69,.7,silver)");
edit("pick=new THREE.Vector3(-.15,.88,.58),drop=new THREE.Vector3(.45,1.04,.08)", "pick=new THREE.Vector3(-.28,.88,.7),drop=new THREE.Vector3(.45,1.125,.08)");
const old="const from=new THREE.Vector3(positions[a].x,.34,positions[a].z),to=new THREE.Vector3(positions[b].x,.34,positions[b].z);const delta=to.clone().sub(from);const length=delta.length();";
const replacement="const from=new THREE.Vector3(positions[a].x,.34,positions[a].z),to=new THREE.Vector3(positions[b].x,.34,positions[b].z);const heading=to.clone().sub(from).normalize();const clearance=Math.min(1.12/Math.max(.0001,Math.abs(heading.x)),.98/Math.max(.0001,Math.abs(heading.z)));from.addScaledVector(heading,clearance);to.addScaledVector(heading,-clearance);const delta=to.clone().sub(from);const length=delta.length();if(length<.2)return;";
edit(old,replacement);
// Match transported part bottoms to the exact roller crown (.467 m).
edit(".setY(.48)", ".setY(.522)");
// Stop labels following the floor directly: anchor dotted leaders to machine bodies,
// then resolve collisions in left and right gutters in screen space.
const oldLabel="positions.forEach((p,i)=>{const label=labels.current[i];if(!label)return;labelPosition.set(p.x,.1,p.z+.9).project(camera);label.style.left=`${(labelPosition.x*.5+.5)*el.clientWidth}px`;label.style.top=`${(-labelPosition.y*.5+.5)*el.clientHeight}px`;label.style.opacity=labelPosition.z>1?'0':'1'});";
const newLabel="const projected=positions.map((p,i)=>{labelPosition.set(p.x,1.15,p.z).project(camera);return{i,x:(labelPosition.x*.5+.5)*el.clientWidth,y:(-labelPosition.y*.5+.5)*el.clientHeight,visible:labelPosition.z<1}});const sorted=[...projected].sort((a,b)=>a.x-b.x);const split=Math.ceil(sorted.length/2);const groups=[sorted.slice(0,split),sorted.slice(split)];groups.forEach((group,side)=>{group.sort((a,b)=>a.y-b.y);const h=el.clientHeight;const margin=14;const gap=Math.min(57,(h-30)/Math.max(1,group.length));group.forEach((point,index)=>{const label=labels.current[point.i],line=leaders.current[point.i],dot=leaderDots.current[point.i];if(!label||!line||!dot)return;const lw=label.offsetWidth||118;const top=THREE.MathUtils.clamp(h/2-(group.length*gap)/2+index*gap,margin,h-53);const left=side===0?10:el.clientWidth-lw-10;label.style.left=left+'px';label.style.top=top+'px';label.style.opacity=point.visible?'1':'0';const endX=side===0?left+lw:left;const endY=top+21;const bendX=endX+(side===0?16:-16);line.setAttribute('d',`M ${point.x.toFixed(1)} ${point.y.toFixed(1)} L ${bendX} ${endY} L ${endX} ${endY}`);line.style.opacity=point.visible?(point.i===selectedRef.current?'0.9':'0.45'):'0';dot.setAttribute('cx',String(point.x));dot.setAttribute('cy',String(point.y));dot.style.opacity=point.visible?'1':'0'})});";
edit(oldLabel,newLabel);
const marker='<div className="webgl-canvas" ref={canvasHost}/>';
edit(marker,marker+'<svg className="twin-leaders" aria-hidden="true">{facility.stations.map((_,i)=><g key={i}><path ref={el=>{leaders.current[i]=el}}/><circle ref={el=>{leaderDots.current[i]=el}} r={selected===i?3.3:2.1}/></g>)}</svg>');
const oldLabelBody='<i className={`tiny ${facility.util[i]>=94?\'amber\':\'green\'}`}/><strong>{name}</strong><span>{facility.util[i]}%</span>';
const newLabelBody='<span className="callout-head"><i className={`tiny ${facility.util[i]>=94?\'amber\':\'green\'}`}/><strong>{name}</strong><b>{String(i+1).padStart(2,\'0\')}</b></span><span className="callout-detail">{facility.util[i]>=94?\'Constraint candidate\':\'Demo utilization\'}<b>{facility.util[i]}%</b></span><span className="callout-meter"><i style={{width:`${facility.util[i]}%`}}/></span>';
edit(oldLabelBody,newLabelBody);
fs.writeFileSync(file,s);
