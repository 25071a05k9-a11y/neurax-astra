import fs from 'node:fs';
const file='C:/NURAX/astra-showcase/src/FactoryScene.tsx';let s=fs.readFileSync(file,'utf8');
const old="const movingArms:THREE.Group[]=[];";
if(!s.includes(old))throw new Error('robot array missing');
s=s.replace(old,"const robots:{base:THREE.Group;shoulder:THREE.Group;elbow:THREE.Group;wrist:THREE.Group;fingers:THREE.Mesh[];part:THREE.Mesh;origin:THREE.Vector3}[]=[];");
const begin=s.indexOf('  box(group,.85,.7,.75,.42,.43,.08,ivory);');const end=s.indexOf('\n+ }else',begin)>=0?s.indexOf('\n+ }else',begin):s.indexOf('\n }else if(/inspection',begin);
if(begin<0||end<0)throw new Error('robot block missing');
const robot=`  box(group,.85,.7,.75,.42,.43,.08,ivory);box(group,1.12,.09,.9,.4,.83,.06,metal);box(group,.52,.18,.48,-.15,.48,.58,graphite);box(group,.55,.05,.51,-.15,.59,.58,metal);
  cylinder(group,.3,.23,-.72,.24,-.2,graphite);const arm=new THREE.Group();arm.position.set(-.72,.39,-.2);group.add(arm);cylinder(arm,.16,.3,0,.1,0,orange);
  const shoulder=new THREE.Group();shoulder.position.y=.25;arm.add(shoulder);const upperLength=.83,lowerLength=.8;
  const shoulderJoint=cylinder(shoulder,.17,.29,0,0,0,graphite);shoulderJoint.rotation.x=Math.PI/2;box(shoulder,upperLength,.2,.24,upperLength/2,0,0,orange);box(shoulder,.45,.06,.25,.4,.12,0,ivory);
  const elbow=new THREE.Group();elbow.position.x=upperLength;shoulder.add(elbow);const elbowJoint=cylinder(elbow,.145,.28,0,0,0,graphite);elbowJoint.rotation.x=Math.PI/2;box(elbow,lowerLength,.15,.18,lowerLength/2,0,0,orange);box(elbow,.47,.05,.19,.32,.1,0,ivory);
  const wrist=new THREE.Group();wrist.position.x=lowerLength;elbow.add(wrist);box(wrist,.27,.12,.22,0,0,0,metal);const fingers=[box(wrist,.045,.19,.08,-.14,-.13,0,graphite),box(wrist,.045,.19,.08,.14,-.13,0,graphite)];
  const part=box(group,.17,.12,.16,-.15,.69,.58,silver);robots.push({base:arm,shoulder,elbow,wrist,fingers,part,origin:new THREE.Vector3(-.72,.64,-.2)});
`;
s=s.slice(0,begin)+robot+s.slice(end);
s=s.replace("movingArms.forEach((a,i)=>{a.rotation.y=Math.sin(time*.7+i)*.34});",`robots.forEach((robot,i)=>{
 const phase=((time+i*1.5)%9)/9;
 const smooth=(v:number)=>{const t=THREE.MathUtils.clamp(v,0,1);return t*t*t*(t*(t*6-15)+10)};
 const pick=new THREE.Vector3(-.15,.88,.58),drop=new THREE.Vector3(.45,1.04,.08),pickHigh=pick.clone().add(new THREE.Vector3(0,.55,0)),dropHigh=drop.clone().add(new THREE.Vector3(0,.4,0));
 const target=new THREE.Vector3();let state='Approach';
 if(phase<.18){target.lerpVectors(pickHigh,pick,smooth(phase/.18));state='Approach'}
 else if(phase<.28){target.copy(pick);state='Grip'}
 else if(phase<.43){target.lerpVectors(pick,pickHigh,smooth((phase-.28)/.15));state='Lift'}
 else if(phase<.61){target.lerpVectors(pickHigh,dropHigh,smooth((phase-.43)/.18));state='Transfer'}
 else if(phase<.74){target.lerpVectors(dropHigh,drop,smooth((phase-.61)/.13));state='Place'}
 else if(phase<.81){target.copy(drop);state='Release'}
 else if(phase<.9){target.lerpVectors(drop,dropHigh,smooth((phase-.81)/.09));state='Return'}
 else{target.lerpVectors(dropHigh,pickHigh,smooth((phase-.9)/.1));state='Return'}
 const delta=target.clone().sub(robot.origin),radial=Math.hypot(delta.x,delta.z);const l1=.83,l2=.8;const cosine=THREE.MathUtils.clamp((radial*radial+delta.y*delta.y-l1*l1-l2*l2)/(2*l1*l2),-.999,.999);const bend=-Math.acos(cosine);const shoulderAngle=Math.atan2(delta.y,radial)-Math.atan2(l2*Math.sin(bend),l1+l2*Math.cos(bend));
 robot.base.rotation.y=-Math.atan2(delta.z,delta.x);robot.shoulder.rotation.z=shoulderAngle;robot.elbow.rotation.z=bend;robot.wrist.rotation.z=-shoulderAngle-bend;
 const closed=phase>=.25&&phase<.77;const gap=phase<.25&&phase>=.18?THREE.MathUtils.lerp(.16,.1,smooth((phase-.18)/.07)):phase>=.74&&phase<.81?THREE.MathUtils.lerp(.1,.16,smooth((phase-.74)/.07)):closed?.1:.16;robot.fingers[0].position.x=-gap;robot.fingers[1].position.x=gap;
 if(closed)robot.part.position.copy(target).add(new THREE.Vector3(0,-.19,0));else if(phase>=.77){robot.part.position.copy(drop).add(new THREE.Vector3(smooth((phase-.81)/.19)*.4,-.19,0))}else robot.part.position.copy(pick).add(new THREE.Vector3(0,-.19,0));
 if(i===0&&cycleLabel.current){cycleLabel.current.textContent=playRef.current?state:'Paused';cycleLabel.current.parentElement?.style.setProperty('--cycle-progress',String(phase*100)+'%')}
 });`);
s=s.replace("const [error,setError]=useState(false);", "const cycleLabel=useRef<HTMLSpanElement>(null);const [error,setError]=useState(false);");
s=s.replace("<div className=\"twin-stage\"><div", "<div className=\"twin-stage\">{facility.stations.some(s=>/assembly|robot|cell|weld/i.test(s))&&<div className=\"robot-cycle\"><i/><span>ROBOT CYCLE</span><strong ref={cycleLabel}>Approach</strong><div/></div>}<div");
// A calmer key light preserves the materials and machining detail in both themes.
s=s.replace("renderer.toneMappingExposure=dark?1.7:1.35", "renderer.toneMappingExposure=dark?1.35:1.12");
s=s.replace("new THREE.DirectionalLight(0xfff6e5,3.5)", "new THREE.DirectionalLight(0xfff6e5,2.7)");
fs.writeFileSync(file,s);
