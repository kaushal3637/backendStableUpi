# Backend StableUPI - ERC-7702 UserOp Processor

A backend service that processes ERC-7702 UserOperations and facilitates USDC transfers with UPI payment integration.

## Features

- **ERC-7702 UserOp Processing**: Validates and executes UserOperations on various blockchain networks
- **USDC Transfers**: Securely transfers USDC tokens to treasury after UserOp execution
- **UPI Integration**: Initiates UPI payments after successful USDC transfers
- **Multi-Chain Support**: Supports Ethereum, Arbitrum, Sepolia, and Arbitrum Sepolia
- **Security**: API key authentication, rate limiting, and comprehensive error handling

## Architecture

```
Frontend (7702 UserOp + UPI Details) → Backend → Blockchain → Treasury → UPI Payment
```

## API Endpoints

### POST /api/payments/process

Processes an ERC-7702 UserOp and initiates the complete payment flow.

**Headers:**
```
Content-Type: application/json
X-API-Key: your_api_key
```

**Request Body:**
```json
{
  "userOp": {
    "sender": "0x1234567890123456789012345678901234567890",
    "nonce": "0x1",
    "initCode": "0x",
    "callData": "0x...",
    "callGasLimit": "0x186a0",
    "verificationGasLimit": "0x186a0",
    "preVerificationGas": "0x5208",
    "maxFeePerGas": "0x5f5e100",
    "maxPriorityFeePerGas": "0x5f5e100",
    "paymasterAndData": "0x",
    "signature": "0x..."
  },
  "upiMerchantDetails": {
    "pa": "merchant@upi",
    "pn": "Merchant Name",
    "am": "100.00",
    "cu": "INR",
    "mc": "1234",
    "tr": "TXN123456"
  },
  "chainId": 421614
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionHash": "0x...",
    "upiPaymentId": "upi_txn_123",
    "status": "completed"
  }
}
```

### GET /api/payments/status/:transactionHash

Gets the status of a payment by transaction hash.

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionHash": "0x...",
    "userOpStatus": "completed",
    "usdcTransferStatus": "completed",
    "upiPaymentStatus": "initiated"
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "development"
}
```

## Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Blockchain Configuration
ETHEREUM_RPC_URL=https://1rpc.io/eth
ARBITRUM_RPC_URL=https://1rpc.io/arb
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
SEPOLIA_RPC_URL=https://1rpc.io/sepolia

# Private Keys (Use secure key management in production)
BACKEND_PRIVATE_KEY=your_backend_private_key_here
TREASURY_ADDRESS=0xYourTreasuryAddressHere

# ERC-7702 Configuration
ENTRYPOINT_ADDRESS=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
ACCOUNT_FACTORY_ADDRESS=0xYourAccountFactoryAddress

# UPI Payment Configuration
UPI_API_ENDPOINT=https://api.upi-provider.com
UPI_API_KEY=your_upi_api_key
UPI_MERCHANT_ID=your_merchant_id

# Security
API_KEY=your_api_key_for_frontend_auth
```

## Installation & Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Start the server:**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

## Supported Networks

| Network | Chain ID | USDC Contract |
|---------|----------|---------------|
| Ethereum Mainnet | 1 | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |
| Arbitrum One | 42161 | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 |
| Sepolia Testnet | 11155111 | 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8 |
| Arbitrum Sepolia | 421614 | 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d |

## Security Features

- **API Key Authentication**: All endpoints require valid API keys
- **Rate Limiting**: Prevents abuse with configurable rate limits
- **Input Validation**: Comprehensive validation using Joi schemas
- **Security Headers**: Helmet.js provides security headers
- **CORS Protection**: Configurable CORS policies
- **Error Handling**: Secure error responses without sensitive information

## Development

### Project Structure

```
src/
├── index.ts              # Main application entry point
├── routes/
│   └── payment.ts        # Payment processing routes
├── services/
│   ├── config.ts         # Configuration management
│   ├── userOpService.ts  # ERC-7702 UserOp processing
│   ├── usdcService.ts    # USDC transfer logic
│   ├── upiService.ts     # UPI payment integration
│   └── paymentOrchestrator.ts # Main payment flow orchestration
├── middleware/
│   └── security.ts       # Security and rate limiting
├── types/
│   └── index.ts          # TypeScript type definitions
└── utils/                # Utility functions
```

### Testing

```bash
npm test
```

## Production Deployment

1. **Environment Setup:**
   - Use secure key management (AWS KMS, Azure Key Vault, etc.)
   - Configure production RPC endpoints
   - Set up monitoring and logging

2. **Security Considerations:**
   - Use HTTPS in production
   - Implement proper API key rotation
   - Set up monitoring and alerting
   - Regular security audits

3. **Scaling:**
   - Implement database for transaction tracking
   - Add Redis for session management
   - Consider load balancing for high traffic

## License

ISC
