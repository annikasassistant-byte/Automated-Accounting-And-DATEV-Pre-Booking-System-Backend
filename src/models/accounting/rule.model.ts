import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const conditionSchema = new Schema(
  {
    field: {
      type: String,
      enum: [
        'purpose',
        'counterpartyName',
        'counterpartyIban',
        'counterpartyEmail',
        'amountCents',
        'source',
        'txnType',
        'direction',
        'rawDescription',
        'article',
      ],
      required: true,
    },
    operator: {
      type: String,
      enum: [
        'contains',
        'starts_with',
        'ends_with',
        'exact',
        'regex',
        'any_of',
        'all_of',
        'eq',
        'lt',
        'lte',
        'gt',
        'gte',
        'between',
        'is_negative',
        'is_positive',
      ],
      required: true,
    },
    value: { type: Schema.Types.Mixed, default: null },
    caseSensitive: { type: Boolean, default: false },
  },
  { _id: false },
);

const actionSchema = new Schema(
  {
    konto: { type: String, required: true, trim: true },
    gegenkonto: { type: String, required: true, trim: true },
    buKey: { type: String, default: '', trim: true },
    bookingTextTemplate: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const ruleSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  enabled: { type: Boolean, default: true, index: true },
  priority: { type: Number, default: 100, index: true },
  conditions: { type: [conditionSchema], default: [] },
  actions: { type: actionSchema, required: true },
  source: {
    type: String,
    enum: ['manual', 'suggested_accepted', 'seed'],
    default: 'manual',
  },
  stats: {
    matchCount: { type: Number, default: 0 },
    lastMatchedAt: { type: Date, default: null },
  },
});

applyBaseModel(ruleSchema, mongoose, { softDelete: true, audit: true });

const Rule = mongoose.models.Rule || mongoose.model('Rule', ruleSchema);

export { ruleSchema };
export default Rule;
