import { BaseRepository } from './base.repository.js';
import Account from '../models/accounting/account.model.js';

export class AccountRepository extends BaseRepository {
  constructor() {
    super(Account, 'Account');
  }

  async findByNumber(number: string) {
    return this.findOne({ number: String(number).trim() });
  }

  async listAll(activeOnly = false) {
    const filter = activeOnly ? { active: true } : {};
    return this.findMany(filter, { limit: 500, page: 1, sort: 'number' });
  }
}
