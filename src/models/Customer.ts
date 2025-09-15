import mongoose from 'mongoose';

const CustomerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  vpa: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true,
    lowercase: true
  },

  // Status and metadata
  isActive: {
    type: Boolean,
    default: true
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
CustomerSchema.index({ name: 1 });
CustomerSchema.index({ isActive: 1 });
CustomerSchema.index({ isTestMode: 1 });
CustomerSchema.index({ createdAt: -1 });

// Pre-save middleware to update the updatedAt field
CustomerSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance method to get beneficiary details for PhonePe
CustomerSchema.methods.getBeneficiaryDetails = function() {
  return {
    beneId: this._id.toString(), // Use MongoDB ObjectId as beneficiary ID
    name: this.name,
    vpa: this.vpa
  };
};

// Instance method to generate UPI QR code data
CustomerSchema.methods.generateUpiQrData = function(amount?: number) {
  const baseData = `upi://pay?pa=${encodeURIComponent(this.vpa)}&pn=${encodeURIComponent(this.name)}&cu=INR`;

  if (amount && amount > 0) {
    return `${baseData}&am=${amount.toFixed(2)}`;
  }

  return baseData;
};

// Static method to find by VPA
CustomerSchema.statics.findByVpa = function(vpa: string) {
  return this.findOne({ vpa: vpa.toLowerCase(), isActive: true });
};

// Define the simplified beneficiary details interface
interface BeneficiaryDetails {
  beneId: string; // MongoDB ObjectId
  name: string;
  vpa: string;
}

// Define the interface for the Customer document
interface ICustomer extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  vpa: string;
  isActive: boolean;
  isTestMode: boolean;
  totalReceived: number;
  totalPaid: number;
  transactionCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastPaymentAt?: Date;
  getBeneficiaryDetails(): BeneficiaryDetails;
  generateUpiQrData(amount?: number): string;
}

// Define the interface for the Customer model
interface ICustomerModel extends mongoose.Model<ICustomer> {
  findByVpa(vpa: string): Promise<ICustomer | null>;
}

// Create the model with proper typing
const CustomerModel = mongoose.models.Customer as ICustomerModel || mongoose.model<ICustomer, ICustomerModel>('Customer', CustomerSchema, 'Customers');

export default CustomerModel;
