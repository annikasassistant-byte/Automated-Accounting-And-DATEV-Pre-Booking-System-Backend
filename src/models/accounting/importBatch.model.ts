import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const importErrorSchema = new Schema(
  {
    row: { type: Number, default: null },
    message: { type: String, required: true },
  },
  { _id: false },
);

const balanceCheckSchema = new Schema(
  {
    expectedGuthaben: { type: Number, default: null },
    calculatedGuthaben: { type: Number, default: null },
    matched: { type: Boolean, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const importBatchSchema = new Schema({
  source: {
    type: String,
    enum: ['bank', 'paypal'],
    required: true,
    index: true,
  },
  filename: { type: String, required: true, trim: true },
  fileHash: { type: String, required: true, trim: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  periodStart: { type: Date, default: null },
  periodEnd: { type: Date, default: null },
  rowCount: { type: Number, default: 0 },
  createdCount: { type: Number, default: 0 },
  duplicateCount: { type: Number, default: 0 },
  skippedCount: { type: Number, default: 0 },
  openCount: { type: Number, default: 0 },
  matchedCount: { type: Number, default: 0 },
  conflictCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed', 'duplicate_file'],
    default: 'processing',
    index: true,
  },
  balanceCheck: { type: balanceCheckSchema, default: null },
  importErrors: { type: [importErrorSchema], default: [] },
  summary: { type: Schema.Types.Mixed, default: null },
});

applyBaseModel(importBatchSchema, mongoose, { softDelete: true, audit: true });

const ImportBatch = mongoose.models.ImportBatch || mongoose.model('ImportBatch', importBatchSchema);

export { importBatchSchema };
export default ImportBatch;
