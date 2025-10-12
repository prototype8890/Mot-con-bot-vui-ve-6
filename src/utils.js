export const delay = (ms)=> new Promise(r=>setTimeout(r, ms));
export function fmt(n){ return Number(n)/1e18; }
