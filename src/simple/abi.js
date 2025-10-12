export const IUniswapV2Factory = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
  'function getPair(address,address) view returns (address)'
];

export const IUniswapV2Pair = [
  'event Mint(address indexed sender, uint amount0, uint amount1)',
  'event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)',
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)'
];

export const IUniswapV2Router = [
  'function factory() view returns (address)',
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
  'function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)',
  'function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) payable returns (uint amountToken,uint amountETH,uint liquidity)'
];


export const IERC20 = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
];

// ✅ FIX: Thêm SELECTORS thiếu
export const SELECTORS = {
  removeLiquidity: [
    '0x02751cec', // removeLiquidity
    '0xbaa2abde', // removeLiquidityETH
    '0x2195995c', // removeLiquidityWithPermit
    '0xded9382a', // removeLiquidityETHWithPermit
    '0x5b0d5984', // removeLiquidityETHSupportingFeeOnTransferTokens
    '0xaf2979eb', // removeLiquidityETHWithPermitSupportingFeeOnTransferTokens
  ],
  // ✅ FIX #2: Đúng selector cho burn(address) của UniswapV2Pair
  // burn(uint256) của ERC20 = 0x89afcb44 (WRONG)
  // burn(address) của Pair = 0x89afcb44 (CORRECT)
  burn: '0x89afcb44'
};