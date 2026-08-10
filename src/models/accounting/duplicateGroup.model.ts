import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const duplicateGroupSchema = new Schema({
  kind: {
    type: String,
    enum: ['fingerprint', 'raw_row', 'possible', 'already_exported'],
    default: 'possible',
  },
  transactionIds: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
  reason: { type: String, default: '' },
  status: {
    type: String,
    enum: ['open', 'merged', 'ignored', 'keep_both'],
    default: 'open',
    index: true,
  },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
});

applyBaseModel(duplicateGroupSchema, mongoose, { softDelete: true, audit: true });

const DuplicateGroup =
  mongoose.models.DuplicateGroup || mongoose.model('DuplicateGroup', duplicateGroupSchema);

export { duplicateGroupSchema };
export default DuplicateGroup;
