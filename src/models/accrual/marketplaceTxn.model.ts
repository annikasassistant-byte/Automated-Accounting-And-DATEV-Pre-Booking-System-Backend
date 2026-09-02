import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import { MARKETPLACES, MARKETPLACE_TXN_TYPES } from '../../enums/accrual.js';

const { Schema } = mongoose;

const marketplaceTxnSchema = new Schema({
  importBatchId: {
    type: Schema.Types.ObjectId,
    ref: 'ImportBatch',
    required: true,
    index: true,
  },
  marketplace: { type: String, enum: MARKETPLACES, required: true, index: true },

  txnType: { type: String, enum: MARKETPLACE_TXN_TYPES, required: true, index: true },
  sourceRecordId: { type: String, required: true, trim: true },
  sourceIdentityKey: { type: String, required: true, trim: true, index: true },

  marketplaceOrderId: { type: String, default: null, trim: true, index: true },
  financialTransactionId: { type: String, default: null, trim: true, index: true },
  settlementId: { type: String, default: null, trim: true, index: true },

  txnDate: { type: Date, required: true, index: true },
  description: { type: String, default: '', trim: true },

  originalCurrency: { type: String, default: 'EUR', uppercase: true, trim: true },
  originalAmountCents: { type: Number, required: true },
  eurAmountCents: { type: Number, default: null },
  exchangeRate: { type: Number, default: null },
  exchangeRateDate: { type: Date, default: null },
  exchangeRateSource: { type: String, default: null, trim: true },

  rawRow: { type: Schema.Types.Mixed, default: null },
  businessEventId: {
    type: Schema.Types.ObjectId,
    ref: 'BusinessEvent',
    default: null,
    index: true,
  },
});

marketplaceTxnSchema.index(
  { sourceIdentityKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);
marketplaceTxnSchema.index({ marketplace: 1, marketplaceOrderId: 1, txnType: 1 });

applyBaseModel(marketplaceTxnSchema, mongoose, { softDelete: true, audit: true });

const MarketplaceTxn =
  mongoose.models.MarketplaceTxn || mongoose.model('MarketplaceTxn', marketplaceTxnSchema);

export { marketplaceTxnSchema };
export default MarketplaceTxn;
