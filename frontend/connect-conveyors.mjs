import fs from 'node:fs';
const p='C:/NURAX/astra-showcase/src/FactoryScene.tsx';let s=fs.readFileSync(p,'utf8');
s=s.replace("powerPreference:'low-power'", "powerPreference:'high-performance'").replace('Math.min(devicePixelRatio,1.7)','Math.min(3,Math.max(2,devicePixelRatio))').replace('sun.shadow.mapSize.set(1024,1024)','sun.shadow.mapSize.set(2048,2048)');
s=s.replaceAll('positions[a].x,.34,positions[a].z','positions[a].x,.5,positions[a].z').replaceAll('positions[b].x,.34,positions[b].z','positions[b].x,.5,positions[b].z').replaceAll('1.12/Math.max(.0001,Math.abs(heading.x)),.98/Math.max(.0001,Math.abs(heading.z))','.82/Math.max(.0001,Math.abs(heading.x)),.6/Math.max(.0001,Math.abs(heading.z))').replaceAll('.setY(.522)','.setY(.682)');
s=s.replace('for(const x of [-length/3,length/3])box(belt,.09,.34,.38,x,-.22,0,metal);','for(const x of [-length/3,length/3])box(belt,.09,.5,.38,x,-.3,0,metal);for(const x of [-length/2,length/2]){box(belt,.24,.13,.59,x,-.035,0,graphite);for(const z of [-.29,.29])box(belt,.3,.09,.06,x,.08,z,amber)}');
s=s.replace('<path ref={el=>{leaders.current[i]=el}}/>','<path fill="none" stroke="var(--green)" strokeWidth="1" strokeDasharray="2.5 4" ref={el=>{leaders.current[i]=el}}/>');
s=s.replace('if(closed)robot.part.position.copy(target)', 'robot.part.rotation.y=closed?robot.base.rotation.y:0;if(closed)robot.part.position.copy(target)');
fs.writeFileSync(p,s);
