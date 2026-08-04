import {
  UserRepository,
  RefreshTokenRepository,
  AuditRepository,
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

  reset() {
    this.#singletons.clear();
  }
}

export const container = new Container();
export default container;
