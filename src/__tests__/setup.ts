import { jest } from '@jest/globals';

// Mock pg Pool
jest.mock('pg', () => {
  const mockPool = {
    query: jest.fn(),
    end: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mockPool) };
});

// Mock AWS SQS client
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  SendMessageCommand: jest.fn(),
  ReceiveMessageCommand: jest.fn(),
  DeleteMessageCommand: jest.fn(),
  GetQueueAttributesCommand: jest.fn()
}));

// Mock environment variables
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'test-db';
process.env.DB_USER = 'test-user';
process.env.DB_PASSWORD = 'test-password';
process.env.WEBHOOK_ENDPOINT = 'https://test-webhook.pipedream.net';
process.env.WEBHOOK_QUEUE_URL = 'https://sqs.test-region.amazonaws.com/test-queue';
process.env.WEBHOOK_DLQ_URL = 'https://sqs.test-region.amazonaws.com/test-dlq';
process.env.STAGE = 'test'; 