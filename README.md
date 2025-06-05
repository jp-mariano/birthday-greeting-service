# Birthday Greeting Service

A serverless application that sends birthday greetings to users at 9am in their local timezone.

## Architecture

The service uses AWS serverless services:
- API Gateway for REST endpoints
- Lambda for compute
- DynamoDB for data storage
- EventBridge Scheduler for timezone-aware scheduling
- SQS for dead letter queue
- Pipedream RequestBin for webhook testing

### Key Features
- Timezone-aware scheduling using EventBridge Scheduler
- Automatic validation of IANA timezone identifiers
- Message delivery tracking with retry mechanism
- Efficient birthday querying using DynamoDB GSI
- Automatic cleanup of old message logs using DynamoDB TTL

## Getting Started

### Prerequisites
- Node.js v20+
- AWS Account
- AWS CLI configured with appropriate credentials
- Serverless Framework (`npm install -g serverless`)
- Pipedream account for RequestBin (free tier available)

### Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update `.env` with your values:
```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=default

# DynamoDB Tables (will be created during deployment)
USERS_TABLE=birthday-service-users
MESSAGE_LOGS_TABLE=birthday-service-logs

# Webhook Configuration
WEBHOOK_ENDPOINT=https://YOUR_REQUESTBIN_URL.pipedream.net  # Get this from Pipedream

# These will be available after first deployment
BIRTHDAY_SENDER_LAMBDA_ARN=  # Leave empty for first deployment
SCHEDULER_ROLE_ARN=          # Leave empty for first deployment
```

### Installation

1. Install dependencies:
```bash
npm install
```

2. Deploy to AWS:
```bash
npm run deploy -- --stage prod
```

3. After deployment, update `.env` with the generated Lambda ARN and Role ARN from the deployment output.

### Testing the Service

1. Create a RequestBin endpoint:
   - Go to https://pipedream.com/requestbin
   - Sign up/Login to Pipedream
   - Click "Create Source"
   - Select "HTTP / Webhook" as the trigger
   - Copy the generated URL to your `.env` file as WEBHOOK_ENDPOINT

2. Create a test user with today's date as birthday:
```bash
curl -X POST https://your-api-url/users -H "Content-Type: application/json" -d '{
  "firstName": "Test",
  "lastName": "User",
  "birthday": "YYYY-MM-DD",  # Use today's date
  "location": "America/New_York"
}'
```

3. The service will automatically:
   - Find users with birthdays today
   - Schedule messages for 9am in their local timezone
   - Send birthday greetings to your RequestBin endpoint

4. Monitor message delivery in your Pipedream dashboard

### API Endpoints

#### Create User
```bash
POST /users
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "birthday": "1990-01-15",
  "location": "America/New_York"  # Must be valid IANA timezone identifier
}
```

Response:
```json
{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "firstName": "John",
  "lastName": "Doe",
  "birthday": "1990-01-15",
  "location": "America/New_York",
  "birthdayMD": "01-15",
  "createdAt": "2024-01-15T00:00:00.000Z",
  "updatedAt": "2024-01-15T00:00:00.000Z"
}
```

#### Update User
```bash
PUT /users/{userId}
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Smith",
  "birthday": "1990-02-15",
  "location": "Europe/London"
}
```

#### Delete User
```bash
DELETE /users/{userId}
```

### System Flow

1. Daily Aggregator (runs at 00:00 UTC):
   - Queries DynamoDB for users with birthdays today
   - Creates message logs for tracking
   - Schedules messages using EventBridge Scheduler

2. Birthday Message Sender:
   - Triggered by EventBridge at scheduled time (9am user's local time)
   - Sends greeting to RequestBin endpoint
   - Updates message status in DynamoDB

### Data Models

#### User
```typescript
{
  userId: string;          // UUID
  firstName: string;
  lastName: string;
  birthday: string;        // YYYY-MM-DD
  location: string;        // IANA timezone (e.g., 'America/New_York')
  birthdayMD: string;     // MM-DD for querying
}
```

#### Message Log
```typescript
{
  messageId: string;       // userId_YYYY-MM-DD
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastAttempt?: string;   // ISO datetime
  error?: string;
  ttl: number;            // Unix timestamp for auto-deletion
}
```

### Data Validation

The service includes robust validation:
1. Location validation:
   - Must be a valid IANA timezone identifier
   - Examples: 'America/New_York', 'Asia/Tokyo', 'Europe/London'
   - Full list: [IANA Time Zone Database](https://www.iana.org/time-zones)

2. Date validation:
   - Birthday must be in YYYY-MM-DD format
   - Date must be valid (e.g., "2024-02-30" is invalid)

3. Message tracking:
   - Automatic retry on failure
   - Error logging with details
   - 30-day retention using DynamoDB TTL

## Production Deployment

1. Set up AWS credentials
2. Update environment variables in serverless.yml
3. Deploy:
```bash
npm run deploy -- --stage prod
```

## Testing

Run the test suite:
```bash
npm test
```

## Error Handling

The service includes comprehensive error handling:
1. Invalid timezone/location errors
2. Message delivery failures
3. Database operation errors
4. Scheduler errors

All errors are logged with appropriate context for debugging. 