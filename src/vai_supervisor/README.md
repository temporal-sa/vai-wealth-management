# Wealth Management Agent Example using Vercel AI SDK (CLI)

Demonstrates how to use the [Vercel AI SDK](https://ai-sdk.dev/) using tools to hand off to other agents.

The Temporal version of this example is located [here](../temporal_supervisor/README.md)

Scenarios currently implemented include
* Add Beneficiary - add a new beneficiary to your account
* List Beneficiaries - shows a list of beneficiaries and their relationship to the account owner
* Delete Beneficiary - delete a beneficiary from your account
* Open Investment Account - opens a new investment account
* List Investments - shows a list of accounts and their current balances
* Close Investment Account - closes an investment account

## Prerequisities

- [Node.js 20+](https://nodejs.org/)
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

## Install dependencies

From the project root:

```bash
npm install
```

## Set up your Gemini API key

Create `setllmkey.sh` at the project root with your key:

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="<your-key-here>"
```

`setllmkey.sh` is gitignored. The start scripts source it automatically.

## Run

From the project root:

```bash
source setllmkey.sh && npm run vai
```

Example Output
```
Welcome to ABC Wealth Management. How can I help you?
Enter your message: Who are my beneficiaries?

Supervisor Agent: I can help with that. What is your client ID?

Enter your message: 123
Handed off from Supervisor Agent to Beneficiary Agent

Beneficiary Agent: Here are your beneficiaries:
* John Doe (son)
* Jane Doe (daughter)
* Joan Doe (spouse)

Would you like to add, delete, or list your beneficiaries?

Enter your message: What investment accounts do I have?
Handed off from Beneficiary Agent to Supervisor Agent
Handed off from Supervisor Agent to Investment Agent

Investment Agent: Here are your investment accounts:
* Checking: $1000
* Savings: $2312.08
* 401K: $11070.89

Would you like to open, close or list your investment accounts?

Enter your message: end
```

You can also add and delete beneficiaries and open and close investment accounts.
