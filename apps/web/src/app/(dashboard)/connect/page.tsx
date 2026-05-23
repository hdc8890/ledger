import { PlaidLinkButton } from '@/components/plaid-link-button';

export default function ConnectPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-24">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Connect your bank</h1>
        <p className="mt-2 text-gray-500">
          Securely connect your financial accounts via Plaid to get started.
        </p>
      </div>
      <PlaidLinkButton />
    </main>
  );
}
