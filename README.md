# timestable

timestable is a learning app for practicing multiplication and division tables with a FastAPI backend and an Angular frontend. It primarily aims at making it easier to track what a child already can and cannot yet do when multiple people practice with them.

## Production

The production version is hosted at [1x1.rempfer.eu](https://1x1.rempfer.eu).

## Repository layout

- `frontend/` Angular application
- `backend/` FastAPI application
- `db/` database migration scripts
- `server/` deployment and systemd configuration

## Local development

Database:

Install and run a PostgreSQL server.

Frontend:

```bash
cd frontend
npm install
npm start
```

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export TIMESTABLE_DB_NAME=your-user
export TIMESTABLE_DB_USER=your-db-name
export TIMESTABLE_DB_PASSWORD=your-password
export TIMESTABLE_SECRET_KEY=your-long-random-secret #we should replace the HMAC id obfuscation with random bytes as obfuscated IDs and get rid of this
python -m uvicorn fastapi_backend:app --reload
```

If you keep your variables in an env file, you can load them in bash before starting uvicorn:

```bash
set -a
source PATH/TO/timestable.env
set +a

python -m uvicorn fastapi_backend:app --reload
```

## Collaboration

This repository is set up for shared development. Please keep changes small, explain behavior in pull requests, and avoid committing secrets or machine-specific configuration.

## Open source status

This project is licensed under GPL-3.0. See `LICENSE` for details.