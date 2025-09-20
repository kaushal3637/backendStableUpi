import mongoose from 'mongoose';

// Define the schema for allowlisted wallets
const AllowlistedWalletSchema = new mongoose.Schema({
  // Lowercase wallet address (unique, indexed)
  walletAddressLower: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  // Checksum-cased wallet address
  checksumAddress: {
    type: String,
    required: true,
    trim: true
  },

  // Sanctions screening result
  isSanctioned: {
    type: Boolean,
    required: true,
    default: false,
    index: true
  },
  identifications: [
    {
      category: { type: String },
      name: { type: String },
      description: { type: String },
      url: { type: String }
    }
  ],
  screenedAt: {
    type: Date
  },
  addedToAllowlistAt: {
    type: Date
  }
}, {
  timestamps: true // Automatically manages createdAt and updatedAt
});

// Remove duplicate index definition if present
// (Do not add AllowlistedWalletSchema.index({ walletAddressLower: 1 }, { unique: true }); again)

// Interfaces
export interface IAllowlistedWallet extends mongoose.Document {
  walletAddressLower: string;
  checksumAddress: string;
  isSanctioned: boolean;
  identifications?: Array<{
    category?: string;
    name?: string;
    description?: string;
    url?: string;
  }>;
  screenedAt?: Date;
  addedToAllowlistAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAllowlistedWalletModel extends mongoose.Model<IAllowlistedWallet> {}

// Use the model if already compiled, otherwise compile it
const AllowlistedWalletModel = (mongoose.models.AllowlistedWallet as IAllowlistedWalletModel) ||
  mongoose.model<IAllowlistedWallet, IAllowlistedWalletModel>('AllowlistedWallet', AllowlistedWalletSchema, 'AllowlistedWallets');

export default AllowlistedWalletModel;
