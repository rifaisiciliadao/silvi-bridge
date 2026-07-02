# Security Policy

## Reporting

Do not open public issues for suspected secrets, API-key exposure, private data,
or vulnerabilities that could affect deployed infrastructure.

Report security concerns privately to the Rifai Sicilia DAO maintainers.

## Secrets

This repository is public. Real Silvi API keys and deployment secrets must only
live in local ignored files or hosting-platform secret stores.

The only committed environment file is:

- `backend/.env.example`

If a real secret is ever committed, rotate it immediately before relying on any
history rewrite.
