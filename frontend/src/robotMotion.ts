import {MathUtils,Vector3} from 'three';
export const ROBOT_ORIGIN=new Vector3(-.72,.64,-.2);
export const UPPER_ARM=.83;
export const FOREARM=.8;
export const CYCLE_SECONDS=9;
export const PICK=new Vector3(-.28,.877,.7);
export const DROP=new Vector3(.67,.877,0);
export function smooth(v:number){const t=MathUtils.clamp(v,0,1);return t*t*t*(t*(t*6-15)+10)}
export function robotPose(seconds:number,offset=0){
 const phase=(((seconds+offset)%CYCLE_SECONDS)+CYCLE_SECONDS)%CYCLE_SECONDS/CYCLE_SECONDS;
 const pickHigh=PICK.clone().add(new Vector3(0,.55,0)),dropHigh=DROP.clone().add(new Vector3(0,.4,0));
 const target=new Vector3();let state='Approach';
 if(phase<.18){target.lerpVectors(pickHigh,PICK,smooth(phase/.18));state='Approach'}
 else if(phase<.28){target.copy(PICK);state='Grip'}
 else if(phase<.43){target.lerpVectors(PICK,pickHigh,smooth((phase-.28)/.15));state='Lift'}
 else if(phase<.61){target.lerpVectors(pickHigh,dropHigh,smooth((phase-.43)/.18));state='Transfer'}
 else if(phase<.74){target.lerpVectors(dropHigh,DROP,smooth((phase-.61)/.13));state='Place'}
 else if(phase<.81){target.copy(DROP);state='Release'}
 else if(phase<.9){target.lerpVectors(DROP,dropHigh,smooth((phase-.81)/.09));state='Return'}
 else{target.lerpVectors(dropHigh,pickHigh,smooth((phase-.9)/.1));state='Return'}
 const delta=target.clone().sub(ROBOT_ORIGIN),radial=Math.hypot(delta.x,delta.z);
 const cosine=MathUtils.clamp((radial*radial+delta.y*delta.y-UPPER_ARM**2-FOREARM**2)/(2*UPPER_ARM*FOREARM),-.999,.999);
 const elbow=-Math.acos(cosine),shoulder=Math.atan2(delta.y,radial)-Math.atan2(FOREARM*Math.sin(elbow),UPPER_ARM+FOREARM*Math.cos(elbow)),yaw=-Math.atan2(delta.z,delta.x);
 const closed=phase>=.25&&phase<.77;
 const gap=phase<.25&&phase>=.18?MathUtils.lerp(.16,.1,smooth((phase-.18)/.07)):phase>=.74&&phase<.81?MathUtils.lerp(.1,.16,smooth((phase-.74)/.07)):closed?.1:.16;
 const part=closed?target.clone().add(new Vector3(0,-.19,0)):phase>=.77?DROP.clone().add(new Vector3(smooth((phase-.81)/.19)*.4,-.19,0)):PICK.clone().add(new Vector3(0,-.19,0));
 return{phase,state,target,yaw,shoulder,elbow,wrist:-shoulder-elbow,closed,gap,part};
}
export function robotJoints(pose:ReturnType<typeof robotPose>){
 const origin=ROBOT_ORIGIN.clone();
 const first=new Vector3(UPPER_ARM*Math.cos(pose.shoulder),UPPER_ARM*Math.sin(pose.shoulder),0).applyAxisAngle(new Vector3(0,1,0),pose.yaw).add(origin);
 const hand=new Vector3(FOREARM*Math.cos(pose.shoulder+pose.elbow),FOREARM*Math.sin(pose.shoulder+pose.elbow),0).applyAxisAngle(new Vector3(0,1,0),pose.yaw).add(first);
 return{origin,elbow:first,hand};
}
