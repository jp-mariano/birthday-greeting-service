# Birthday Greeting Service

A serverless application that sends birthday greetings to users on their birthday. Built with AWS Lambda, PostgreSQL RDS, SQS, and EventBridge Scheduler.

## Features

- User management (create, update, delete)
- Automatic birthday message scheduling
- Timezone-aware message delivery (sends at 9 AM in user's local timezone)
- Message delivery tracking with retry mechanism
- Webhook integration for sending messages
- Dead Letter Queue (DLQ) for failed message handling
- Automatic hourly retry of failed messages
- Robust error handling and validation
- High test coverage (>97%)

## Architecture

The service consists of four main Lambda functions:

1. `userApi` - Handles user CRUD operations (except Read)
   - POST `/users` - Create a new user
   - PUT `/users/{userId}` - Update a user
   - DELETE `/users/{userId}` - Delete a user

2. `birthdayChecker` - Runs every 15 minutes to check for birthdays
   - Identifies users with birthdays
   - Batches messages (200 per batch)
   - Sends to webhook queue

3. `webhookSender` - Processes webhook queue messages
   - Sends birthday greetings via webhook
   - Handles failures with DLQ
   - Updates greeting status in database

4. `webhookRetry` - Hourly retry mechanism for failed messages
   - Processes messages from DLQ
   - Redrives messages to main queue
   - Implements exponential backoff via SQS settings

### Infrastructure Components:

- **PostgreSQL RDS**
  - Stores user information (name, birthday, timezone)
  - Tracks last greeting sent timestamp
  - Optimized queries for birthday checks
  - Timezone-aware date calculations

- **SQS Queues**
  - Main webhook queue (batch size: 1, visibility timeout: 30s)
  - Dead Letter Queue for failed webhook attempts
  - Maximum retry attempts: 3
  - Message retention: 14 days

- **EventBridge Rules**
  - Birthday check scheduler (every 15 minutes)
  - DLQ processor (hourly)
  - Timezone-aware scheduling

- **CloudWatch**
  - Lambda function logs and metrics
  - SQS queue metrics
  - Error tracking and alerting
  - Performance monitoring

### Message Flow

1. Birthday Check Flow:
   - EventBridge triggers birthday check every 15 minutes
   - Lambda queries database for upcoming birthdays
   - Messages batched (max 200 per message) and sent to webhook queue

2. Webhook Processing Flow:
   - SQS triggers webhook Lambda for each message
   - Webhook Lambda attempts delivery
   - Success: Update last greeting sent in database
   - Failure: Message moved to DLQ

3. Retry Flow:
   - Hourly EventBridge rule triggers retry Lambda
   - Retry Lambda pulls from DLQ
   - Messages redriven to main queue
   - Failed messages remain in DLQ for next retry

## Prerequisites

### Required Software
- Node.js v20.x or later
- npm
- PostgreSQL 15.x or later
- AWS CLI v2.x

### AWS Requirements
- AWS Account with permissions for:
  - Lambda function creation and management
  - RDS instance creation and management
  - SQS queue creation and management
  - EventBridge rule creation and management
  - CloudWatch logs access
  - IAM role and policy management

### Development Environment
- IDE with TypeScript support recommended (e.g., VS Code)
- Terminal access
- Git

### Knowledge Prerequisites
- Basic understanding of:
  - TypeScript/Node.js development
  - AWS Serverless architecture
  - PostgreSQL databases
  - RESTful APIs

## Local Development

### Initial Setup

1. Clone the repository and install dependencies:
```bash
git clone git@github.com:jp-mariano/birthday-greeting-service.git
cd birthday-greeting-service
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Update .env with your configuration
```

### Development Workflow

This is a serverless application that runs on AWS Lambda. Local development primarily consists of:

1. Writing and testing code locally
2. Running automated tests
3. Deploying to AWS for integration testing

## Deployment

1. Configure AWS credentials:
```bash
aws configure
```

2. Deploy to development stage:
```bash
npm run deploy:dev
```

3. Deploy to production:
```bash
npm run deploy:prod
```

### Post-Deployment

After deployment, verify:
1. Lambda functions are deployed and configured correctly
2. SQS queues (main and DLQ) are created
3. EventBridge rules are created and enabled
4. Database migrations were successful
5. Test the webhook endpoint is accessible

## Testing

The project has comprehensive test coverage:

```bash
npm test
```

### Test Structure

- `__tests__/handlers/`
  - `users.test.ts` - User API endpoint tests
  - `birthday.test.ts` - Birthday checker tests
  - `webhook.test.ts` - Webhook sender tests
  - `webhookRetry.test.ts` - DLQ retry tests
- `__tests__/services/`
  - `database.test.ts` - Database service tests

## Monitoring and Maintenance

Key metrics to monitor:
- SQS queue depth
- DLQ message count
- Lambda execution times
- Database connection pool health
- Webhook response times

## License

MIT (see [LICENSE](LICENSE))