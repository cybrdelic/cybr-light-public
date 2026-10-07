// One deadline covers every startup await, including a pending adapter/device.
// A resource that arrives after the check closed must be released by its owner.
export function createCompileDeadline({milliseconds=40000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let closed=false,expired=false,timer;
 const error=new Error('Startup comparison did not finish within '+milliseconds/1000+' seconds; check will close its device');
 const timeout=new Promise((_,reject)=>{timer=setTimer(()=>{closed=true;expired=true;reject(error);},milliseconds);});
 timeout.catch(()=>{});
 return {
  wait(pending,onLateResult){
   const operation=Promise.resolve(pending).then(value=>{if(closed){onLateResult?.(value);throw error;}return value;});
   return Promise.race([operation,timeout]);
  },
  close(){closed=true;clearTimer(timer);},
  get expired(){return expired;},
 };
}
