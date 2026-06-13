# Security Policy

## Supported versions

This project is currently in early development. Security fixes are applied to the `main` branch.

## Reporting a vulnerability

Please do not open a public GitHub issue for suspected security vulnerabilities.

If you find a vulnerability, please contact the maintainer privately through the GitHub profile associated with this repository.

When reporting, include:

- A short description of the issue
- Steps to reproduce
- Potential impact
- Affected files or features
- Suggested fix, if available

## Security scope

Important areas include:

- API-key handling
- Environment variable usage
- Data import/export validation
- Local storage of portfolio data
- Network requests to market-data providers
- CSV parsing and untrusted input handling

## API keys and secrets

Do not commit real API keys, tokens, certificates, or production `.env` files.

Use `.env.example` for documentation only.
