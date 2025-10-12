
import { ethers } from 'ethers';
import { IUniswapV2Router } from './abi.js';

export async function priceTokensForEth({ provider, router, token, weth, amountIn }){
  const iface = new ethers.Interface(IUniswapV2Router);
  try{
    const raw = await provider.call({ to: router, data: iface.encodeFunctionData('getAmountsOut',[amountIn,[token,weth]]) });
    const [out] = new ethers.Interface(['function x(uint[] a)']).decodeFunctionResult('x', raw);
    return out[out.length-1];
  }catch{ return 0n; }
}

export async function priceEthForTokens({ provider, router, token, weth, oneEth=ethers.parseEther('1') }){
  const iface = new ethers.Interface(IUniswapV2Router);
  try{
    const raw = await provider.call({ to: router, data: iface.encodeFunctionData('getAmountsOut',[oneEth,[weth,token]]) });
    const [out] = new ethers.Interface(['function x(uint[] a)']).decodeFunctionResult('x', raw);
    return out[out.length-1];
  }catch{ return 0n; }
}
