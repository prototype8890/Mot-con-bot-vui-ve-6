
import { keccak256, toUtf8Bytes } from 'ethers';

function selector(sig){ return '0x'+keccak256(toUtf8Bytes(sig)).slice(2,10); }

export function computeBlockedSelectors(names){
  return names.map(s=>selector(s).toLowerCase());
}

export function bytecodeHasAnySelector(bytecode, selList){
  if (!bytecode || bytecode==='0x') return false;
  const hex = bytecode.toLowerCase();
  return selList.some(s => hex.includes(s.slice(2)));
}
