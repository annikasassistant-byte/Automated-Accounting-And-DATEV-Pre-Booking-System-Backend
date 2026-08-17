import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const historySchema = new Schema(
  {
    status: { type: String },
    action: { type: String, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorLabel: { type: String, default: 'System' },
    at: { type: Date, default: Date.now },
    note: { type: String, default: null },
  },
  { _id: true },
);

const bookingSchema = new Schema(
  {
    konto: { type: String, default: null, trim: true },
    gegenkonto: { type: String, default: null, trim: true },
    buKey: { type: String, default: null, trim: true },
    bookingText: { type: String, default: null, trim: true },
    sollHaben: { type: String, enum: ['S', 'H', null], default: null },
  },
  { _id: false },
);

const transactionSchema = new Schema({
  importBatchId: { type: Schema.Types.ObjectId, ref: 'ImportBatch', required: true, index: true },
  source: { type: String, enum: ['bank', 'paypal'], required: true, index: true },
  fingerprint: { type: String, required: true, trim: true },
  rawRowHash: { type: String, trim: true, index: true },

  bookingDate: { type: Date, required: true, index: true },
  valueDate: { type: Date, default: null },
  amountCents: { type: Number, required: true },
  currency: { type: String, default: 'EUR', uppercase: true },

  counterpartyName: { type: String, default: '', trim: true },
  counterpartyIban: { type: String, default: null, trim: true },
  counterpartyEmail: { type: String, default: null, trim: true },
  purpose: { type: String, default: '', trim: true },
  article: { type: String, default: null, trim: true },
  rawDescription: { type: String, default: '', trim: true },

  paypal: {
    transactionCode: { type: String, default: null },
    type: { type: String, default: null },
    status: { type: String, default: null },
    feeCents: { type: Number, default: null },
    relatedTransactionCode: { type: String, default: null },
    guthabenAfter: { type: Number, default: null },
    subject: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
  },

  bank: {
    bookingText: { type: String, default: null },
    mandateRef: { type: String, default: null },
    creditorId: { type: String, default: null },
    customerRef: { type: String, default: null },
  },

  rawRow: { type: Schema.Types.Mixed, default: null },

  bookability: {
    type: String,
    enum: ['bookable', 'skipped', 'balance_only'],
    default: 'bookable',
    index: true,
  },
  skipReason: { type: String, default: null },

  status: {
    type: String,
    enum: [
      'imported',
      'suggested',
      'matched',
      'open',
      'conflict',
      'reviewed',
      'skipped',
      'exported',
    ],
    default: 'imported',
    index: true,
  },

  matchedRuleIds: [{ type: Schema.Types.ObjectId, ref: 'Rule' }],
  systemMatched: { type: Boolean, default: false },
  systemRuleId: { type: String, default: null },

  booking: { type: bookingSchema, default: () => ({}) },
  confidence: { type: Number, default: null },
  suggestionMeta: { type: Schema.Types.Mixed, default: null },

  exportedInBatchId: { type: Schema.Types.ObjectId, ref: 'ExportBatch', default: null, index: true },
  history: { type: [historySchema], default: [] },

  duplicateOfId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
  isDuplicate: { type: Boolean, default: false, index: true },
});

transactionSchema.index(
  { fingerprint: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);
transactionSchema.index({ status: 1, bookingDate: -1 });
transactionSchema.index({ source: 1, bookingDate: -1 });

applyBaseModel(transactionSchema, mongoose, { softDelete: true, audit: true });

const Transaction =
  mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

export { transactionSchema };
export default Transaction;
