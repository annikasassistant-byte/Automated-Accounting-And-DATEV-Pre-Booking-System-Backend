import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import { EVIDENCE_SOURCES } from '../../enums/accrual.js';

const { Schema } = mongoose;

const evidenceSchema = new Schema({
  businessEventId: {
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

  source: { type: String, enum: EVIDENCE_SOURCES, required: true, index: true },
  sourceRecordId: { type: String, required: true, trim: true },
  sourceIdentityKey: { type: String, required: true, trim: true, index: true },

  filename: { type: String, default: null, trim: true },
  fileHash: { type: String, default: null, trim: true, index: true },
  rowNumber: { type: Number, default: null },

  rawRow: { type: Schema.Types.Mixed, default: null },
  parsedFields: { type: Schema.Types.Mixed, default: null },

  attachedAt: { type: Date, default: Date.now },
});

evidenceSchema.index(
  { sourceIdentityKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);

applyBaseModel(evidenceSchema, mongoose, { softDelete: true, audit: true });

const Evidence = mongoose.models.Evidence || mongoose.model('Evidence', evidenceSchema);

export { evidenceSchema };
export default Evidence;
