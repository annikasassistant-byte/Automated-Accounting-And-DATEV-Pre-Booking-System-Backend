import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const ruleSuggestionSchema = new Schema({
  derivedFromTransactionIds: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
  patternSignature: { type: String, required: true, trim: true, index: true },
  sampleTexts: [{ type: String }],
  proposedConditions: { type: [Schema.Types.Mixed], default: [] },
  proposedActions: {
    konto: { type: String, default: null },
    gegenkonto: { type: String, default: null },
    buKey: { type: String, default: '' },
    bookingTextTemplate: { type: String, default: null },
  },
  proposedName: { type: String, default: null },
  confidence: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'ignored'],
    default: 'pending',
    index: true,
  },
  acceptedRuleId: { type: Schema.Types.ObjectId, ref: 'Rule', default: null },
});

applyBaseModel(ruleSuggestionSchema, mongoose, { softDelete: true, audit: true });

const RuleSuggestion =
  mongoose.models.RuleSuggestion || mongoose.model('RuleSuggestion', ruleSuggestionSchema);

export { ruleSuggestionSchema };
export default RuleSuggestion;
