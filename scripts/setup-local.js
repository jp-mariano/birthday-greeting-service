const { spawn } = require('child_process');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const AWS_REGION = 'us-east-1';

const tables = {
  users: {
    TableName: 'birthday-service-users-local',
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'birthdayMD', AttributeType: 'S' },
      { AttributeName: 'location', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' }
    ],
    GlobalSecondaryIndexes: [{
      IndexName: 'birthdayIndex',
      KeySchema: [
        { AttributeName: 'birthdayMD', KeyType: 'HASH' },
        { AttributeName: 'location', KeyType: 'RANGE' }
      ],
      Projection: { ProjectionType: 'ALL' }
    }],
    BillingMode: 'PAY_PER_REQUEST'
  },
  logs: {
    TableName: 'birthday-service-logs-local',
    AttributeDefinitions: [
      { AttributeName: 'messageId', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'messageId', KeyType: 'HASH' }
    ],
    BillingMode: 'PAY_PER_REQUEST',
    TimeToLiveSpecification: {
      AttributeName: 'ttl',
      Enabled: true
    }
  }
};

async function createTable(tableConfig) {
  const command = [
    'aws dynamodb create-table',
    `--endpoint-url ${LOCALSTACK_ENDPOINT}`,
    `--region ${AWS_REGION}`,
    `--table-name ${tableConfig.TableName}`,
    `--attribute-definitions '${JSON.stringify(tableConfig.AttributeDefinitions)}'`,
    `--key-schema '${JSON.stringify(tableConfig.KeySchema)}'`,
    `--billing-mode ${tableConfig.BillingMode}`
  ];

  if (tableConfig.GlobalSecondaryIndexes) {
    command.push(`--global-secondary-indexes '${JSON.stringify(tableConfig.GlobalSecondaryIndexes)}'`);
  }

  const fullCommand = command.join(' ');
  console.log(`Running command: ${fullCommand}`);

  try {
    const { stdout, stderr } = await exec(fullCommand);
    console.log(`✅ Created table ${tableConfig.TableName}`);
    if (stdout) console.log('Output:', stdout);
  } catch (error) {
    if (error.stderr && error.stderr.includes('ResourceInUseException')) {
      console.log(`ℹ️  Table ${tableConfig.TableName} already exists`);
    } else {
      console.error(`❌ Error creating table ${tableConfig.TableName}:`, error.stderr || error);
    }
  }
}

async function waitForLocalStack() {
  console.log('🔄 Checking LocalStack availability...');
  for (let i = 0; i < 30; i++) {
    try {
      await exec(`curl -s ${LOCALSTACK_ENDPOINT}/health`);
      console.log('✅ LocalStack is ready');
      return true;
    } catch (error) {
      if (i === 29) {
        console.error('❌ LocalStack not available after 30 attempts');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  try {
    console.log('🚀 Setting up local development environment...');
    
    // Wait for LocalStack to be ready
    const isLocalStackReady = await waitForLocalStack();
    if (!isLocalStackReady) {
      console.error('❌ LocalStack is not running. Please start it first.');
      process.exit(1);
    }

    // Create tables
    await createTable(tables.users);
    await createTable(tables.logs);

    console.log('✨ Local setup complete!');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

main(); 