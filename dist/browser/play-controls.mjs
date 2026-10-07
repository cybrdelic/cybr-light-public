// Free-flight input, driven by the renderer's existing frame loop (no second RAF).
export function advanceFlight(pose,input,seconds){
 const offset=(yaw,pitch)=>[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
 const old=offset(pose.yaw,pose.pitch),eye=old.map((v,i)=>pose.target[i]+v*pose.distance);
 const yaw=pose.yaw-input.lookX*.002,pitch=Math.max(-1.55,Math.min(1.55,pose.pitch+input.lookY*.002));
 const back=offset(yaw,pitch),right=[Math.cos(yaw),0,-Math.sin(yaw)];
 const movement=back.map((v,i)=>-v*input.forward+right[i]*input.side+(i===1?input.up:0));
 const length=Math.hypot(...movement),step=Math.min(Math.max(seconds,0),.05)*input.speed/Math.max(length,1);
 return {yaw,pitch,distance:pose.distance,target:eye.map((v,i)=>v+movement[i]*step-back[i]*pose.distance)};
}
export function mountPlayControls(canvas,api){
 const keys=new Set();let lookX=0,lookY=0,last=0;
 const abort=new AbortController(),listen=(target,event,fn,options={})=>target.addEventListener(event,fn,{...options,signal:abort.signal});
 const button=document.createElement('button');button.type='button';button.className='play-control';
 button.textContent='Enter play view';button.title='Free-flight camera; no collision controller';
 document.querySelector('header').append(button);
 const hint=document.createElement('div');hint.className='play-hint';hint.hidden=true;
 hint.textContent='WASD move · Mouse look · Q/E down/up · Shift faster · Esc release';document.body.append(hint);
 const clear=()=>{keys.clear();lookX=lookY=0;last=0;};
 listen(button,'click',async()=>{
  if(!api.ready())return;
  try{await canvas.requestPointerLock();api.resume();}catch{button.textContent='Click to retry mouse capture';}
 });
 listen(document,'pointerlockchange',()=>{
  const active=document.pointerLockElement===canvas;clear();hint.hidden=!active;
  document.body.classList.toggle('play-active',active);button.textContent=active?'Esc to release':'Enter play view';
 });
 listen(document,'mousemove',event=>{if(document.pointerLockElement===canvas){lookX+=event.movementX;lookY+=event.movementY;}});
 const recognized=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight']);
 listen(document,'keydown',event=>{if(document.pointerLockElement===canvas&&recognized.has(event.code)){event.preventDefault();keys.add(event.code);}});
 listen(document,'keyup',event=>keys.delete(event.code));
 listen(window,'blur',clear);listen(document,'visibilitychange',clear);
 listen(canvas,'pointerdown',event=>{if(document.pointerLockElement===canvas)event.stopImmediatePropagation();},{capture:true});
 listen(canvas,'wheel',event=>{if(document.pointerLockElement===canvas){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
 return {
  update(now){
   if(document.pointerLockElement!==canvas){last=0;return;}
   const dt=last?(now-last)/1000:0;last=now;
   if(!keys.size&&!lookX&&!lookY)return;
   const pose=api.pose(),speed=Math.max(.01,pose.distance*.35)*(keys.has('ShiftLeft')||keys.has('ShiftRight')?3:1);
   api.apply(advanceFlight(pose,{lookX,lookY,forward:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),up:Number(keys.has('KeyE'))-Number(keys.has('KeyQ')),speed},dt));
   lookX=lookY=0;
  },
  dispose(){abort.abort();clear();if(document.pointerLockElement===canvas)document.exitPointerLock();button.remove();hint.remove();document.body.classList.remove('play-active');}
 };
}
