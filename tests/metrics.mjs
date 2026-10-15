// Deterministic structural benchmark; this is not a listening-quality score.
import {createContext,propose,pcs,soundKey} from '../harmony.js';
const source=[46,53,50,62,60,64],state=createContext(source);
for(const edge of [false,true]){
 const draws=Array.from({length:30},(_,seed)=>propose(source,state,edge,seed)).flat();
 const result={mode:edge?'edge':'normal',draws:draws.length,distinctSounds:new Set(draws.map(c=>soundKey(c.voicing))).size,meanOutside:draws.reduce((s,c)=>s+c.outside,0)/draws.length,meanStringMotion:draws.reduce((s,c)=>s+c.comparison.stringMotion,0)/draws.length,meanPitchClasses:draws.reduce((s,c)=>s+pcs(c.voicing).length,0)/draws.length,maxStringLeap:Math.max(...draws.map(c=>c.comparison.maxLeap))};
 console.log(JSON.stringify(result));
}
