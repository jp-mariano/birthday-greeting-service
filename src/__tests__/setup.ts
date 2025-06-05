// Mock AWS SDK clients
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  }))
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: jest.fn()
    }))
  },
  PutCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  DeleteCommand: jest.fn(),
  QueryCommand: jest.fn(),
  GetCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  CreateScheduleCommand: jest.fn(),
  DeleteScheduleCommand: jest.fn()
}));

// Mock environment variables
process.env.USERS_TABLE = 'test-users-table';
process.env.MESSAGE_LOGS_TABLE = 'test-logs-table';
process.env.WEBHOOK_ENDPOINT = 'https://test-webhook.pipedream.net';
process.env.BIRTHDAY_SENDER_LAMBDA_ARN = 'test:lambda:arn';
process.env.SCHEDULER_ROLE_ARN = 'test:role:arn'; 