import {
  UserRepository,
  RefreshTokenRepository,
  AuditRepository,
  AccountRepository,
  ImportBatchRepository,
  TransactionRepository,
  RuleRepository,
  RuleSuggestionRepository,
  ExportBatchRepository,
  ExportItemRepository,
  CompanySettingsRepository,
  DuplicateGroupRepository,
  SystemPolicyRepository,
} from '../repositories/index.js';
import {
  AuthService,
  UserService,
  TokenService,
  EmailService,
  CacheService,
  ExportService,
  OtpService,
  NotificationService,
  AdminBootstrapService,
  AccountService,
  ImportService,
  TransactionService,
  RuleService,
  SuggestionService,
  DatevExportService,
  ReconciliationService,
  DuplicateService,
  SettingsService,
} from '../services/index.js';

export class Container {
  constructor() {
    this.#singletons = new Map();
  }

  #singletons;

  get(name, factory) {
    if (!this.#singletons.has(name)) {
      this.#singletons.set(name, factory());
    }
    return this.#singletons.get(name);
  }

  get userRepository() {
    return this.get('userRepository', () => new UserRepository());
  }
  get refreshTokenRepository() {
    return this.get('refreshTokenRepository', () => new RefreshTokenRepository());
  }
  get auditRepository() {
    return this.get('auditRepository', () => new AuditRepository());
  }
  get accountRepository() {
    return this.get('accountRepository', () => new AccountRepository());
  }
  get importBatchRepository() {
    return this.get('importBatchRepository', () => new ImportBatchRepository());
  }
  get transactionRepository() {
    return this.get('transactionRepository', () => new TransactionRepository());
  }
  get ruleRepository() {
    return this.get('ruleRepository', () => new RuleRepository());
  }
  get ruleSuggestionRepository() {
    return this.get('ruleSuggestionRepository', () => new RuleSuggestionRepository());
  }
  get exportBatchRepository() {
    return this.get('exportBatchRepository', () => new ExportBatchRepository());
  }
  get exportItemRepository() {
    return this.get('exportItemRepository', () => new ExportItemRepository());
  }
  get companySettingsRepository() {
    return this.get('companySettingsRepository', () => new CompanySettingsRepository());
  }
  get systemPolicyRepository() {
    return this.get('systemPolicyRepository', () => new SystemPolicyRepository());
  }
  get duplicateGroupRepository() {
    return this.get('duplicateGroupRepository', () => new DuplicateGroupRepository());
  }

  get cacheService() {
    return this.get('cacheService', () => new CacheService());
  }
  get otpService() {
    return this.get('otpService', () => new OtpService());
  }
  get emailService() {
    return this.get('emailService', () => new EmailService());
  }
  get notificationService() {
    return this.get('notificationService', () => new NotificationService());
  }
  get tokenService() {
    return this.get(
      'tokenService',
      () => new TokenService({ refreshTokenRepository: this.refreshTokenRepository }),
    );
  }

  get authService() {
    return this.get(
      'authService',
      () =>
        new AuthService({
          userRepository: this.userRepository,
          tokenService: this.tokenService,
          emailService: this.emailService,
          otpService: this.otpService,
          auditRepository: this.auditRepository,
          notificationService: this.notificationService,
          cacheService: this.cacheService,
        }),
    );
  }

  get userService() {
    return this.get(
      'userService',
      () =>
        new UserService({
          userRepository: this.userRepository,
          auditRepository: this.auditRepository,
          cacheService: this.cacheService,
          tokenService: this.tokenService,
        }),
    );
  }

  get exportService() {
    return this.get(
      'exportService',
      () => new ExportService({ userRepository: this.userRepository }),
    );
  }

  get adminBootstrapService() {
    return this.get(
      'adminBootstrapService',
      () =>
        new AdminBootstrapService({
          userRepository: this.userRepository,
          auditRepository: this.auditRepository,
        }),
    );
  }

  get accountService() {
    return this.get(
      'accountService',
      () =>
        new AccountService({
          accountRepository: this.accountRepository,
          auditRepository: this.auditRepository,
        }),
    );
  }

  get importService() {
    return this.get(
      'importService',
      () =>
        new ImportService({
          importBatchRepository: this.importBatchRepository,
          transactionRepository: this.transactionRepository,
          ruleRepository: this.ruleRepository,
          duplicateGroupRepository: this.duplicateGroupRepository,
          auditRepository: this.auditRepository,
          settingsService: this.settingsService,
        }),
    );
  }

  get transactionService() {
    return this.get(
      'transactionService',
      () =>
        new TransactionService({
          transactionRepository: this.transactionRepository,
          ruleRepository: this.ruleRepository,
          auditRepository: this.auditRepository,
          settingsService: this.settingsService,
        }),
    );
  }

  get ruleService() {
    return this.get(
      'ruleService',
      () =>
        new RuleService({
          ruleRepository: this.ruleRepository,
          transactionRepository: this.transactionRepository,
          auditRepository: this.auditRepository,
          settingsService: this.settingsService,
        }),
    );
  }

  get suggestionService() {
    return this.get(
      'suggestionService',
      () =>
        new SuggestionService({
          ruleSuggestionRepository: this.ruleSuggestionRepository,
          ruleRepository: this.ruleRepository,
          transactionRepository: this.transactionRepository,
          auditRepository: this.auditRepository,
        }),
    );
  }

  get datevExportService() {
    return this.get(
      'datevExportService',
      () =>
        new DatevExportService({
          exportBatchRepository: this.exportBatchRepository,
          exportItemRepository: this.exportItemRepository,
          transactionRepository: this.transactionRepository,
          companySettingsRepository: this.companySettingsRepository,
          auditRepository: this.auditRepository,
          settingsService: this.settingsService,
        }),
    );
  }

  get reconciliationService() {
    return this.get(
      'reconciliationService',
      () =>
        new ReconciliationService({
          transactionRepository: this.transactionRepository,
          importBatchRepository: this.importBatchRepository,
          duplicateGroupRepository: this.duplicateGroupRepository,
        }),
    );
  }

  get duplicateService() {
    return this.get(
      'duplicateService',
      () =>
        new DuplicateService({
          duplicateGroupRepository: this.duplicateGroupRepository,
          transactionRepository: this.transactionRepository,
          auditRepository: this.auditRepository,
        }),
    );
  }

  get settingsService() {
    return this.get(
      'settingsService',
      () =>
        new SettingsService({
          companySettingsRepository: this.companySettingsRepository,
          systemPolicyRepository: this.systemPolicyRepository,
          auditRepository: this.auditRepository,
        }),
    );
  }

  reset() {
    this.#singletons.clear();
  }
}

export const container = new Container();
export default container;
