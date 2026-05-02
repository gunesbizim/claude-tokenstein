export class TokensteinError extends Error {
  exitCode = 1;
}
export class UserError extends TokensteinError {
  override exitCode = 2;
}
export class LockBusyError extends TokensteinError {
  override exitCode = 0;
}
export class FxUnavailableError extends TokensteinError {
  override exitCode = 1;
}
export class ConfigError extends UserError {}
export class IngestError extends TokensteinError {}
