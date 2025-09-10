import mongoose from 'mongoose';

// Valid chain IDs for transactions
const VALID_CHAIN_IDS = [421614, 11155111]; // Arbitrum Sepolia and Sepolia

const TransactionSchema = new mongoose.Schema({
  upiId: String, // Payee UPI ID
  merchantName: String, // Name of merchant
  totalUsdToPay: String, // Total USD to pay
  inrAmount: String, // INR amount
  walletAddress: String, // Connected wallet address (optional)
  txnHash: String, // Transaction hash (optional, updated later)

  // Cashfree Payout Details
  payoutTransferId: String, // Cashfree transfer ID
  payoutStatus: String, // Cashfree transfer status (SUCCESS, FAILED, PENDING)
  payoutAmount: Number, // Amount transferred via Cashfree
  payoutRemarks: String, // Remarks for the payout
  payoutInitiatedAt: Date, // When payout was initiated
  payoutProcessedAt: Date, // When payout was processed

  chainId: {
    type: Number,
    required: true,
    enum: {
      values: VALID_CHAIN_IDS,
      message: 'Chain ID must be either 421614 (Arbitrum Sepolia) or 11155111 (Sepolia)'
    },
    validate: {
      validator: function(chainId: number) {
        return VALID_CHAIN_IDS.includes(chainId);
      },
      message: 'Invalid chain ID. Only Arbitrum Sepolia (421614) and Sepolia (11155111) are supported.'
    }
  },
  isSuccess: {
    type: Boolean,
    default: false
  },
  scannedAt: {
    type: Date,
    default: Date.now
  },
  paidAt: Date,
}, {
  timestamps: true
});

TransactionSchema.index({ txnHash: 1 }, { unique: true, sparse: true });

export default mongoose.models.UpiTransaction || mongoose.model('UpiTransaction', TransactionSchema, 'UpiTransactions');
