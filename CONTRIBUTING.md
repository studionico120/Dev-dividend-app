# Contributing to DividendTracker

Thank you for your interest in contributing to DividendTracker.

DividendTracker is an early-stage open-source mobile app for local-first dividend portfolio tracking. Contributions that improve reliability, maintainability, documentation, tests, and user experience are welcome.

## Code of conduct

Please be respectful and constructive. Keep discussions focused on the project and assume good intent.

## Ways to contribute

Good contribution areas include:

- Fixing bugs in portfolio or dividend calculations
- Improving TypeScript types
- Adding validation for CSV import/export
- Improving Japanese and English documentation
- Adding tests for calculation utilities
- Improving error handling for API and network failures
- Improving accessibility and UI consistency
- Adding screenshots, examples, or setup guides
- Improving CI, release notes, and maintainer workflows

## Development setup

```bash
git clone https://github.com/studionico120/Dev-dividend-app.git
cd Dev-dividend-app
npm install --legacy-peer-deps
cp .env.example .env
npm start
```

For development without external API calls, set:

```bash
DEV_MODE=true
```

## Before opening a pull request

Please run:

```bash
npx tsc --noEmit
```

If you add tests or linting in a pull request, please include the command in the PR description.

## Pull request guidelines

A good pull request should include:

- A clear title
- A short description of the change
- Screenshots or screen recordings for UI changes
- Notes about any breaking changes
- Manual test steps
- Related issue links, if any

## Issue guidelines

Before opening a new issue:

1. Search existing issues.
2. Confirm the issue can be reproduced on the latest `main` branch.
3. Include device/platform details when relevant.
4. Include logs or screenshots when helpful.

## Commit style

No strict commit convention is enforced yet. Please use clear, descriptive commit messages.

Examples:

```text
Fix CSV import validation for empty dividend fields
Add type check workflow
Improve portfolio allocation chart labels
```

## Financial-data disclaimer

This project is not investment advice. Contributions should avoid adding recommendation logic, buy/sell signals, or investment advice language unless clearly scoped as user-owned calculations.
