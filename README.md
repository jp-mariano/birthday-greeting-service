# Birthday Greeting Service

A serverless application that sends birthday greetings to users on their birthday. Built with AWS Lambda, DynamoDB, and EventBridge Scheduler.

## Features

- User management (create, update, delete)
- Automatic birthday message scheduling
- Timezone-aware message delivery (sends at 9 AM in user's local timezone)
- Message delivery tracking
- Webhook integration for sending messages
- LocalStack support for local development

## Prerequisites

- Node.js v20.x or later
- Docker (for LocalStack)
- AWS CLI (for local development)
- npm or yarn

## Local Development Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development environment:
```bash
npm run dev
```

This command will:
- Start LocalStack with required services (DynamoDB, EventBridge, Scheduler)
- Create necessary DynamoDB tables
- Start the serverless offline server

The server will start at `http://localhost:3000` with the following endpoints:
- POST `/local/users` - Create a new user
- PUT `/local/users/{userId}` - Update a user
- DELETE `/local/users/{userId}` - Delete a user
- POST `/local/birthday/daily` - Trigger daily birthday check
- POST `/local/birthday/send` - Manually trigger birthday message

### Alternative Setup (Manual Steps)

If you prefer to run each step manually:

1. Start LocalStack:
```bash
npm run start:localstack
```

2. Setup local resources:
```bash
npm run setup:local
```

3. Start the serverless offline server:
```bash
npm run start:local
```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Local Development
STAGE=local
IS_OFFLINE=true
DYNAMODB_ENDPOINT=http://localhost:4566
SCHEDULER_ENDPOINT=http://localhost:4566
EVENTBRIDGE_ENDPOINT=http://localhost:4566
WEBHOOK_ENDPOINT=your_webhook_endpoint_url

# Optional: Override table names
USERS_TABLE=birthday-service-users-local
MESSAGE_LOGS_TABLE=birthday-service-logs-local
```

## Testing the Application

1. Create a user with today's date as birthday:
```bash
curl -X POST http://localhost:3000/local/users \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "birthday": "'$(date +%Y-%m-%d)'",
    "location": "America/New_York"
  }'
```

2. The system will automatically:
   - Create the user in DynamoDB
   - Create a schedule (every minute in local dev, 9 AM user's local time in prod)
   - Send a birthday message via webhook
   - Track message delivery status

3. You can manually trigger the daily birthday check:
```bash
curl -X POST http://localhost:3000/local/birthday/daily
```

## Development Commands

- `npm run dev` - Start complete local development environment
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run TypeScript type checking
- `npm run clean` - Clean build artifacts
- `npm run reinstall` - Clean and reinstall dependencies

## Architecture

The service consists of three main Lambda functions:
1. `userApi` - Handles user CRUD operations
2. `dailyAggregator` - Runs daily to check for birthdays
3. `birthdayMessageSender` - Sends birthday messages via webhook

Data is stored in two DynamoDB tables:
1. `users` - Stores user information with GSI on birthdayMD and location
2. `message-logs` - Tracks message delivery status with TTL

## Troubleshooting

1. If LocalStack services aren't responding:
```bash
npm run start:localstack
```

2. If you need to reset the local environment:
```bash
npm run clean
npm install
npm run dev
```

3. To verify LocalStack services:
```bash
aws --endpoint-url=http://localhost:4566 dynamodb list-tables
aws --endpoint-url=http://localhost:4566 scheduler list-schedules
```

## Production Deployment

For production deployment:

1. Configure AWS credentials
2. Update environment variables for production
3. Deploy using:
```bash
npm run deploy -- --stage prod
```

## License

MIT 