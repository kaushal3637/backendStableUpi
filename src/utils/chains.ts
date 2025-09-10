/**
 * Utility functions for blockchain operations
 */

/**
 * Get blockchain explorer URL for a transaction hash
 * @param chainId - The blockchain network ID
 * @param txHash - The transaction hash
 * @returns Explorer URL or '#' if not supported
 */
export function getExplorerUrl(chainId: number | null | undefined, txHash: string): string {
  if (!chainId) return '#';

  switch (chainId) {
    case 1: // Ethereum Mainnet
      return `https://etherscan.io/tx/${txHash}`;
    case 11155111: // Sepolia Testnet
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case 42161: // Arbitrum One
      return `https://arbiscan.io/tx/${txHash}`;
    case 421614: // Arbitrum Sepolia
      return `https://sepolia.arbiscan.io/tx/${txHash}`;
    default:
      return '#';
  }
}

/**
 * Get chain information by chain ID
 * @param chainId - The blockchain network ID
 * @returns Chain information object or null if not supported
 */
export function getChainInfo(chainId: number) {
  const chainMap: Record<number, { name: string; symbol: string; blockExplorer: string }> = {
    1: { name: 'Ethereum', symbol: 'ETH', blockExplorer: 'https://etherscan.io' },
    11155111: { name: 'Sepolia', symbol: 'ETH', blockExplorer: 'https://sepolia.etherscan.io' },
    42161: { name: 'Arbitrum One', symbol: 'ETH', blockExplorer: 'https://arbiscan.io' },
    421614: { name: 'Arbitrum Sepolia', symbol: 'ETH', blockExplorer: 'https://sepolia.arbiscan.io' },
  };

  return chainMap[chainId] || null;
}

/**
 * Check if a chain ID is supported
 * @param chainId - The blockchain network ID
 * @returns Boolean indicating if the chain is supported
 */
export function isValidChainId(chainId: number): boolean {
  const supportedChains = [1, 11155111, 42161, 421614];
  return supportedChains.includes(chainId);
}
