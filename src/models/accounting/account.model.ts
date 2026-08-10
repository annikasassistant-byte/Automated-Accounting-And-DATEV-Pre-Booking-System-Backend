import mongoose from 'mongoose';
import { applyBaseModel } from '../base.model.js';

const { Schema } = mongoose;

const accountSchema = new Schema({
  number: {
    type: String,
    required: true,
    trim: true,
    maxlength: 16,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255,
  },
  type: {
    type: String,
    enum: ['asset', 'liability', 'expense', 'revenue', 'clearing', 'other'],
    required: true,
    default: 'other',
    index: true,
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  isSystemProtected: {
    type: Boolean,
    default: false,
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: null,
  },
});

accountSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });

applyBaseModel(accountSchema, mongoose, { softDelete: true, audit: true });

const Account = mongoose.models.Account || mongoose.model('Account', accountSchema);

export { accountSchema };
export default Account;
