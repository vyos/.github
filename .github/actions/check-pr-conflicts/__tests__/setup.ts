// Jest setup file
import 'jest';

// Global test setup
beforeEach(() => {
  jest.clearAllMocks();
});

// Mock console methods to avoid noise in test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};