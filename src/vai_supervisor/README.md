# Wealth Management Agent Example using Vercel AI SDK (CLI)

Demonstrates how to use the [Vercel AI SDK](https://ai-sdk.dev/) using tools to hand off to other agents.

The Temporal version of this example is located [here](../temporal_supervisor/README.md)

Scenarios currently implemented include
* Add Beneficiary - add a new beneficiary to your account
* List Beneficiaries - shows a list of beneficiaries and their relationship to the account owner
* Delete Beneficiary - delete a beneficiary from your account
* Open Investment Account - opens a new investment account directly with a simple tool (the Temporal
  version adds KYC, compliance approval and a saga)
* List Investments - shows a list of accounts and their current balances
* Close Investment Account - closes an investment account
* Off-topic questions - questions that are not about beneficiaries or investment accounts are politely
  declined by the supervisor agent (this is handled in the agents' prompts)

## Prerequisites

- [Node.js 20+](https://nodejs.org/) and npm
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

`setllmkey.sh` is gitignored. The CLI has no start script, so source it yourself as shown below.

## Run

From the project root:

```bash
source setllmkey.sh && npm run vai
```

Type `end`, `exit` or `quit` to leave.

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

Investment Agent: You have the following investment accounts:

Checking with a balance of $1,000.00
Savings with a balance of $2,312.08
401K with a balance of $11,070.89

Would you like to open an account, close an account, or list your accounts?

Enter your message: end
```

You can also add and delete beneficiaries and open and close investment accounts.

These changes are saved to the JSON files in `data/` (tracked by git). To reset the demo data, from the
project root:

```bash
git checkout data/
```
