# timestable

timestable is a learning app for practicing multiplication and division tables. It primarily aims at making it easier to track what a child already can and cannot yet do when multiple people practice with them. Theoretically, children could practice with the app by themselves, but mine don't. The app uses PostgresSQL and FastAPI for the backend, and an Angular frontend.

## Production

The production version is hosted at [1x1.rempfer.eu](https://1x1.rempfer.eu). When you access the site, it automatically creates a new randomized ID for you. You can share the link with the ID with other devices and people and they will see and manipulate the same state as you do.

## Repository layout

- `frontend/` Angular application
- `backend/` FastAPI application
- `db/` database migration scripts
- `server/` deployment and systemd configuration

## Local development

Database:

- Install and run a PostgreSQL server
- Import `db/migrate.sql`
- Put credentials for the database and a user with read/write access into the environment variables listed in `server/timestable.env.example` before launching the backend (as shown below)

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
python -m uvicorn fastapi_backend:app --reload
```

## Docker Compose deployment

This repository includes a Docker Compose setup with three services:

- `db`: PostgreSQL
- `backend`: FastAPI served by Uvicorn
- `web`: Nginx serving the built Angular app and proxying `/api` to `backend`

TLS should be terminated by your host Nginx reverse proxy. The containerized Nginx listens on a single HTTP port only.

1. Build and start:

```bash
docker compose up -d --build
```

2. Point host Nginx to `http://127.0.0.1:8080`.
	You can use `deployment/nginx.host-proxy.example.conf` as a starting point.

Notes:

- `db/migrate.sql` is mounted into Postgres init scripts and runs on first initialization of a fresh database volume.
- Only `web` is exposed to the host; `backend` and `db` remain internal to the Docker network.

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
