    "app:dev:saas": "concurrently -k -n 'API,APP,OTLP-GATEWAY,ALERTS-TASK,BILLING-TASK,TELEMETRY-ANALYSIS,COMMON-UTILS' -c 'green.bold,purple.bold,blue.bold,white.bold,yellow.bold,cyan.bold,orange.bold,magenta' 'nx run @hyperdx/api:dev' 'nx run @hyperdx/app:dev' 'HYPERDX_LOG_LEVEL=error yarn workspace @hyperdx/api dev:gateway' 'nx run @hyperdx/api:dev-task check-alerts' 'nx run @hyperdx/api:dev-task calculate-data-ingestion' 'nx run @hyperdx/api:dev-task telemetry-analysis' 'nx run @hyperdx/common-utils:dev'",






in web directory
npx dotenv -e .env.demo -- yarn start