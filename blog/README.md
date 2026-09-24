# Marginal — a blog that runs next to Pulse

**Marginal** is a field-notes blog for engineers: React (Vite) frontend, Node.js/Express API, MySQL.
The code comes from [BlogReact](https://github.com/Vennilavanguvi/BlogReact), adapted to the Project 04 platform.

It shares the cluster (`pulse-eks`) and the tools (Jenkins, SonarQube, Trivy, Nexus, ECR) with Pulse, but is fully separate:

| | Pulse (unchanged) | Marginal blog (this folder) |
|---|---|---|
| Code, pipeline | repository root, `Jenkinsfile` | `blog/`, `blog/Jenkinsfile` |
| Kubernetes namespace | `pulse` | `blog` |
| Load balancer / URL | `pulse-alb` | `blog-alb` (its own URL) |
| ECR images | `pulse-backend`, `pulse-frontend` | `blog-backend`, `blog-frontend` |
| Database | own MySQL, `trending_app` | own MySQL, `blogdb` |
| Secrets (AWS Secrets Manager) | `pulse/prod/app` | `pulse/blog/app` |
| SonarQube project | `pulse-app` | `marginal-blog` |

## Features

- Home page with the latest posts, tag filter and search; article pages with a reading-progress spine and comments
- Accounts with bcrypt-hashed passwords and JWT sessions; signed-in users write posts and comments
- Drafts (`"status": "draft"`) are visible only to their author. The deployment smoke test uses a draft, so releases never add test posts to the homepage

## Set it up (one time)

With admin AWS credentials and a cluster-admin `kubectl`:

```bash
JENKINS_ROLE_NAME=<IAM role of the Jenkins EC2 instance> bash blog/scripts/setup-platform.sh
```

It creates the ECR repositories, lets Jenkins push to them, generates the secrets in AWS Secrets Manager, and creates
the `blog` namespace with RBAC, network policies, MySQL (schema + demo posts) and the Ingress that provisions `blog-alb`.
It prints the blog's URL at the end. Nothing in the `pulse` namespace is touched.

Then in Jenkins: **New Item → Pipeline** (e.g. `marginal-blog`) → *GitHub hook trigger for GITScm polling* →
*Pipeline script from SCM*, this repository, branch `main`, **Script Path `blog/Jenkinsfile`** → **Build Now**.

## How deployments work

Every push to GitHub starts both Jenkins jobs. The blog job builds only if something under `blog/` changed
(manual builds always run): build → tests → SonarQube quality gate → Docker build → Trivy gates → push to Nexus and ECR →
rolling update in the `blog` namespace → `scripts/smoke-test.sh` through the ALB, with automatic rollback if a step fails.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | — | `{ email, password }` → `{ token, user }` |
| GET | `/api/posts` | — | Published posts, newest first (`?page=&limit=&tag=&search=`) |
| GET | `/api/posts/:slug` | optional | One post with its comments (drafts: author only) |
| POST | `/api/posts` | required | `{ title, body, tag?, excerpt?, coverImage?, status? }` → `{ id, slug }` |
| POST | `/api/posts/:slug/comments` | required | `{ body }` |

Probes and metrics: `/api/health` (liveness), `/api/ready` (checks MySQL), `/metrics` (`blog_http_*`, cluster-internal only).

## Run locally

```bash
cd blog
cp backend/.env.example backend/.env      # set DB_PASSWORD and a real JWT_SECRET
cp frontend/.env.example frontend/.env
docker compose --env-file backend/.env --env-file frontend/.env up -d --build
# open http://localhost:8081
```

## Tests

- `backend`: `npm test` — 37 API tests (Node.js test runner, no database needed), LCOV for SonarQube, JUnit for Jenkins
- `frontend`: `npm run build && npm test` — the production bundle calls the same-origin `/api`
- `scripts/smoke-test.sh <url>` — end to end through the ALB: register, login, list, draft post, comment
