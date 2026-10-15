export const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const mod12=n=>((n%12)+12)%12;
export const note=n=>names[mod12(n)]+(Math.floor(n/12)-1);
export const frequency=n=>440*2**((n-69)/12);
export function parse(s){const m=/^([A-Ga-g])([#b]?)(-?\d)$/.exec(s.trim());if(!m)return null;const n=(+m[3]+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[m[1].toUpperCase()]+(m[2]==='#'?1:m[2]==='b'?-1:0);return n>=12&&n<=96?n:null;}
export function voicing(t,f){return t.map((n,i)=>f[i]===null?null:n+f[i]);}
export {chordAnalysis,modalReadings} from './harmony.js';
import {chordAnalysis,createContext,propose} from './harmony.js';
export function analyze(v){return chordAnalysis(v)[0]?.name('flat')??'Silence';}
export function suggest(v,edge=false,seed=0){return v.every(n=>n===null)?[]:propose(v,createContext(v),edge,seed).map(c=>c.voicing);}
