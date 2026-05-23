import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

type PlaidEnvKey = keyof typeof PlaidEnvironments;

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is not set`);
  return value;
}

function buildClient(): PlaidApi {
  const envName = (process.env['PLAID_ENV'] ?? 'sandbox') as PlaidEnvKey;
  // PlaidEnvironments is an open index signature — fall back to sandbox if unrecognised.
  const basePath: string =
    (PlaidEnvironments[envName] as string | undefined) ?? (PlaidEnvironments['sandbox'] as string);

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': getEnvOrThrow('PLAID_CLIENT_ID'),
        'PLAID-SECRET': getEnvOrThrow('PLAID_SECRET'),
      },
    },
  });

  return new PlaidApi(configuration);
}

// Module-level singleton — created once per server process.
// In serverless / edge environments the module may be re-initialized per
// invocation, which is acceptable; the client holds no mutable state.
export const plaidClient: PlaidApi = buildClient();
