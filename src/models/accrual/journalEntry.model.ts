import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';
import { JOURNAL_ENTRY_STATUSES } from '../../enums/accrual.js';

const { Schema } = mongoose;

const journalEntrySchema = new Schema({
  businessEventId: {
    type: Schema.Types.ObjectId,
    ref: 'BusinessEvent',
    required: true,
    index: true,
  },
  postingDate: { type: Date, required: true, index: true },
  description: { type: String, default: '', trim: true },
  status: {
    type: String,
    enum: JOURNAL_ENTRY_STATUSES,
    default: 'draft',
    index: true,
  },
  exportedInBatchId: {
    type: Schema.Types.ObjectId,
    ref: 'ExportBatch',
    default: null,
    index: true,
  },
  metadata: { type: Schema.Types.Mixed, default: null },
});

journalEntrySchema.index({ businessEventId: 1, status: 1 });

applyBaseModel(journalEntrySchema, mongoose, { softDelete: true, audit: true });

const JournalEntry =
  mongoose.models.JournalEntry || mongoose.model('JournalEntry', journalEntrySchema);

export { journalEntrySchema };
export default JournalEntry;
