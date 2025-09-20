import mongoose from 'mongoose';

// Customer schema for Cashfree Payout integration
const CustomerSchema = new mongoose.Schema({
  // Customer identification
  customerId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },

  // UPI Information
  upiId: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  upiName: {
    type: String,
    trim: true
  },

  // Cashfree Beneficiary ID (assigned when beneficiary is created)
  cashfreeBeneficiaryId: {
    type: String,
    sparse: true,
    index: true
  },

  // QR Code information
  qrCodeData: {
    type: String,
    required: true
  },
  qrCodeUrl: {
    type: String
  },

  // Status and metadata
  isActive: {
    type: Boolean,
    default: true
  },
  isBeneficiaryAdded: {
    type: Boolean,
    default: false
  },

  // Test mode flag
  isTestMode: {
    type: Boolean,
    default: true
  },

  // Transaction tracking
  totalReceived: {
    type: Number,
    default: 0
  },
  totalPaid: {
    type: Number,
    default: 0
  },
  transactionCount: {
    type: Number,
    default: 0
  },

  // Sanctions screening
  sanctionsScreened: {
    type: Boolean,
    default: false
  },
  sanctionsScreenedAt: {
    type: Date
  },
  isSanctioned: {
    type: Boolean,
    default: false
  },
  sanctionsIdentifications: [{
    category: String,
    name: String,
    description: String,
    url: String
  }],

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastPaymentAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for performance
CustomerSchema.index({ email: 1 });
CustomerSchema.index({ phone: 1 });
CustomerSchema.index({ isActive: 1 });
CustomerSchema.index({ isTestMode: 1 });
CustomerSchema.index({ createdAt: -1 });

// Pre-save middleware to update the updatedAt field
CustomerSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to generate unique customer ID
CustomerSchema.statics.generateCustomerId = function() {
  return `CUST_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

// Instance method to get beneficiary details for Cashfree
CustomerSchema.methods.getBeneficiaryDetails = function() {
  return {
    beneId: this.cashfreeBeneficiaryId || this.customerId,
    name: this.name,
    email: this.email,
    phone: this.phone,
    address1: "Test Address",
    city: "Test City",
    state: "Test State",
    pincode: "110001",
    bankAccount: {
      accountNumber: "1234567890", // Test account number
      ifsc: "HDFC0000001", // Test IFSC
      accountHolderName: this.name
    },
    vpa: this.upiId
  };
};

// Instance method to generate UPI QR code data
CustomerSchema.methods.generateUpiQrData = function(amount?: number) {
  const baseData = `upi://pay?pa=${encodeURIComponent(this.upiId)}&pn=${encodeURIComponent(this.upiName || this.name)}&cu=INR`;

  if (amount && amount > 0) {
    return `${baseData}&am=${amount.toFixed(2)}`;
  }

  return baseData;
};

// Define the beneficiary details interface
interface BeneficiaryDetails {
  beneId: string;
  name: string;
  email: string;
  phone?: string;
  address1: string;
  city: string;
  state: string;
  pincode: string;
  bankAccount: {
    accountNumber: string;
    ifsc: string;
    accountHolderName: string;
  };
  vpa: string;
}

// Define the interface for the Customer document
interface ICustomer extends mongoose.Document {
  customerId: string;
  name: string;
  email: string;
  phone?: string;
  upiId: string;
  upiName?: string;
  cashfreeBeneficiaryId?: string;
  qrCodeData: string;
  qrCodeUrl?: string;
  isActive: boolean;
  isBeneficiaryAdded: boolean;
  isTestMode: boolean;
  totalReceived: number;
  totalPaid: number;
  transactionCount: number;
  sanctionsScreened: boolean;
  sanctionsScreenedAt?: Date;
  isSanctioned: boolean;
  sanctionsIdentifications: Array<{
    category: string;
    name: string;
    description: string;
    url: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
  lastPaymentAt?: Date;
  getBeneficiaryDetails(): BeneficiaryDetails;
  generateUpiQrData(amount?: number): string;
}

// Define the interface for the Customer model
interface ICustomerModel extends mongoose.Model<ICustomer> {
  generateCustomerId(): string;
}

// Create the model with proper typing
const CustomerModel = mongoose.models.Customer as ICustomerModel || mongoose.model<ICustomer, ICustomerModel>('Customer', CustomerSchema, 'Customers');

export default CustomerModel;
