export const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const mod12=n=>((n%12)+12)%12;
export const note=n=>names[mod12(n)]+(Math.floor(n/12)-1);
export const frequency=n=>440*2**((n-69)/12);
export function parse(s){const m=/^([A-Ga-g])([#b]?)(-?\d)$/.exec(s.trim());if(!m)return null;const n=(+m[3]+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[m[1].toUpperCase()]+(m[2]==='#'?1:m[2]==='b'?-1:0);return n>=12&&n<=96?n:null;}
export function voicing(t,f){return t.map((n,i)=>f[i]===null?null:n+f[i]);}
export function analyze(v){const ns=v.filter(n=>n!==null);if(!ns.length)return 'Silence';const pcs=[...new Set(ns.map(mod12))];for(const [suffix,ints] of [['maj7',[0,4,7,11]],['m7',[0,3,7,10]],['',[0,4,7]],['m',[0,3,7]],['sus2',[0,2,7]],['sus4',[0,5,7]]])for(const root of pcs)if(pcs.length===ints.length&&ints.every(i=>pcs.includes(mod12(root+i))))return names[root]+suffix;return pcs.map(n=>names[n]).join(' · ');}
export function suggest(v,edge=false,seed=0){
 if(v.every(n=>n===null))return [];
 if(!edge){const bass=Math.min(...v.filter(n=>n!==null));const roots=[5,7,2,9];return roots.map((_,j)=>{const root=mod12(bass+roots[(j+seed)%4]);const intervals=j%2?[0,3,7,10]:[0,4,7,11];return v.map(n=>{if(n===null)return null;let best=n,score=Infinity;for(let d=-6;d<=6;d++){const m=n+d;if(m<12||m>108||!intervals.includes(mod12(m-root)))continue;const rank=Math.abs(d)+(d<0?.03:0);if(rank<score){score=rank;best=m;}}return best;});});}
 const patterns=[[1,-1,2,-2,1,0],[-2,1,0,1,-1,2],[0,1,-1,3,-2,1],[3,-2,1,0,2,-1]];
 return patterns.map((_,j)=>v.map((n,i)=>n===null?null:Math.max(12,Math.min(108,n+patterns[(j+seed)%4][i]))));
}
