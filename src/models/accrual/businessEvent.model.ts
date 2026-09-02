import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import {
  BUSINESS_EVENT_STATUSES,
  BUSINESS_EVENT_TYPES,
  MARKETPLACES,
  MATCH_STATUSES,
} from '../../enums/accrual.js';

const { Schema } = mongoose;

const fxSchema = new Schema(
  {
    originalCurrency: { type: String, default: 'EUR', uppercase: true, trim: true },
    originalAmountCents: { type: Number, default: null },
    eurAmountCents: { type: Number, default: null },
    exchangeRate: { type: Number, default: null },
    exchangeRateDate: { type: Date, default: null },
    exchangeRateSource: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const businessEventSchema = new Schema({
  eventType: {
    type: String,
    enum: BUSINESS_EVENT_TYPES,
    required: true,
    index: true,
  },
  marketplace: {
    type: String,
    enum: MARKETPLACES,
    default: null,
    index: true,
  },
  source: { type: String, required: true, trim: true, index: true },
  sourceRecordId: { type: String, required: true, trim: true },
  sourceIdentityKey: { type: String, required: true, trim: true, index: true },

  marketplaceOrderId: { type: String, default: null, trim: true, index: true },
  jtlOrderId: { type: String, default: null, trim: true, index: true },
  jtlInvoiceNumber: { type: String, default: null, trim: true, index: true },
  financialTransactionId: { type: String, default: null, trim: true, index: true },
  settlementId: { type: String, default: null, trim: true, index: true },
  payoutId: { type: String, default: null, trim: true, index: true },

  eventDate: { type: Date, required: true, index: true },
  accountingDate: { type: Date, default: null, index: true },

  fx: { type: fxSchema, default: () => ({}) },

  status: {
    type: String,
    enum: BUSINESS_EVENT_STATUSES,
    default: 'draft',
    index: true,
  },
  matchStatus: {
    type: String,
    enum: [...MATCH_STATUSES, null],
    default: null,
    index: true,
  },

  originalEventId: {
    type: Schema.Types.ObjectId,
    ref: 'BusinessEvent',
    default: null,
    index: true,
  },

  importBatchId: {
    type: Schema.Types.ObjectId,
    ref: 'ImportBatch',
    default: null,
    index: true,
  },
  journalEntryId: {
    type: Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null,
    index: true,
  },

  taxCodeId: { type: Schema.Types.ObjectId, ref: 'TaxCode', default: null },
  metadata: { type: Schema.Types.Mixed, default: null },
});

businessEventSchema.index(
  { sourceIdentityKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);
businessEventSchema.index({ marketplace: 1, marketplaceOrderId: 1, eventType: 1 });
businessEventSchema.index({ status: 1, eventDate: -1 });

applyBaseModel(businessEventSchema, mongoose, { softDelete: true, audit: true });

const BusinessEvent =
  mongoose.models.BusinessEvent || mongoose.model('BusinessEvent', businessEventSchema);

export { businessEventSchema };
export default BusinessEvent;
