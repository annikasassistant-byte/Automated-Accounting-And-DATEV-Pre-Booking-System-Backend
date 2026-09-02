import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const journalLineSchema = new Schema({
  journalEntryId: {
    type: Schema.Types.ObjectId,
    ref: 'JournalEntry',
    required: true,
    index: true,
  },
  businessEventId: {
    type: Schema.Types.ObjectId,
    ref: 'BusinessEvent',
    required: true,
    index: true,
  },

  accountNumber: { type: String, required: true, trim: true, index: true },
  sollHaben: { type: String, enum: ['S', 'H'], required: true },
  amountCents: { type: Number, required: true },
  currency: { type: String, default: 'EUR', uppercase: true, trim: true },
  eurAmountCents: { type: Number, default: null },

  buKey: { type: String, default: null, trim: true },
  taxCodeId: { type: Schema.Types.ObjectId, ref: 'TaxCode', default: null },

  postingDate: { type: Date, required: true, index: true },
  bookingText: { type: String, default: '', trim: true },

  documentReference: { type: String, default: null, trim: true },
  sourceReference: { type: String, default: null, trim: true },

  lineOrder: { type: Number, default: 0 },
});

journalLineSchema.index({ journalEntryId: 1, lineOrder: 1 });
journalLineSchema.index({ accountNumber: 1, postingDate: -1 });

applyBaseModel(journalLineSchema, mongoose, { softDelete: true, audit: true });

const JournalLine = mongoose.models.JournalLine || mongoose.model('JournalLine', journalLineSchema);

export { journalLineSchema };
export default JournalLine;
