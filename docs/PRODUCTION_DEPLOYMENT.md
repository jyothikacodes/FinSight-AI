# Production Deployment Guide

This document describes how the FinSight-AI production deployment pipeline works, how to configure it, and how to troubleshoot common issues.

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Push to main   │────▶│   CI Workflow     │────▶│  Deploy to Production│
│  (or PR merge)  │     │  (ci.yml)         │     │  (deploy-production) │
└─────────────────┘     │                  │     │                      │
                        │ • Type check     │     │ • Downloads CI build │
                        │ • Lint           │     │ • Requires approval  │
                        │ • Test           │     │ • Deploys to Vercel  │
                        │ • Build          │     │ • Posts summary      │
                        │ • Upload artifact│     └──────────────────────┘
                        └──────────────────┘              │
                                                          ▼
                                                 ┌──────────────┐
                                                 │  Approval     │
                                                 │  Gate          │
                                                 │  (maintainer)  │
                                                 └──────────────┘
                                                          │
                                                          ▼
                                                 ┌──────────────┐
                                                 │  Production   │
                                                 │  (Vercel)     │
                                                 └──────────────┘
```

### Flow Summary

1. Code is pushed to `main` (directly or via PR merge).
2. The **CI workflow** (`ci.yml`) runs type checks, linting, tests, and builds the project.
3. On success, the CI workflow uploads the build artifact.
4. The **Deploy to Production** workflow (`deploy-production.yml`) triggers automatically.
5. The `production` GitHub environment requires **maintainer approval** before the deploy job starts.
6. Once approved, the workflow downloads the build artifact and deploys to Vercel.
7. The deployment URL is displayed in the Actions run summary.

Pull request CI is **completely unaffected** — the deployment workflow only triggers on `main`.

---

## GitHub Environment Setup

> **You must configure the `production` environment in the GitHub repository settings.** Environment protection rules cannot be set via workflow YAML — they are configured through the GitHub UI.

### Step 1: Create the Environment

1. Go to your repository on GitHub.
2. Navigate to **Settings → Environments**.
3. Click **New environment**.
4. Name it exactly: `production`.
5. Click **Configure environment**.

### Step 2: Add Required Reviewers

1. In the environment configuration page, check **Required reviewers**.
2. Add one or more maintainers who must approve production deployments.
3. Click **Save protection rules**.

### Step 3: Restrict Deployment Branches

1. Under **Deployment branches and tags**, select **Selected branches and tags**.
2. Click **Add deployment branch or tag rule**.
3. Add the pattern: `main`.
4. Remove any other branch patterns.
5. Click **Save protection rules**.

### Step 4: Add Environment Secrets

Add the following secrets to the `production` environment (**not** as repository-level secrets):

| Secret Name                          | Description                                          |
|--------------------------------------|------------------------------------------------------|
| `VERCEL_TOKEN`                       | Vercel personal access token for deployment          |
| `VERCEL_ORG_ID`                      | Vercel organization/team ID                          |
| `VERCEL_PROJECT_ID`                  | Vercel project ID for FinSight-AI                    |
| `VITE_FIREBASE_API_KEY`             | Firebase API key (production)                        |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Firebase auth domain (production)                    |
| `VITE_FIREBASE_PROJECT_ID`          | Firebase project ID (production)                     |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Firebase storage bucket (production)                 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID (production)            |
| `VITE_FIREBASE_APP_ID`             | Firebase app ID (production)                         |
| `VITE_GEMINI_API_KEY`              | Google Gemini API key (production)                   |

> **Why environment secrets?** Secrets added to the `production` environment are only available to workflows that declare `environment: production`. This means CI runs on PRs and branches other than `main` cannot access production credentials, even if a contributor has write access.

#### How to Get Vercel Credentials

1. **`VERCEL_TOKEN`**: Go to [Vercel Dashboard → Settings → Tokens](https://vercel.com/account/tokens) and create a new token.
2. **`VERCEL_ORG_ID`** and **`VERCEL_PROJECT_ID`**: Run `vercel link` locally in the project directory. The values are written to `.vercel/project.json`.

---

## How Deployments Work

### Automatic Deployment (Recommended)

1. Merge a PR into `main` (or push directly).
2. CI runs automatically and, on success, uploads the build artifact.
3. The `deploy-production.yml` workflow triggers via `workflow_run`.
4. The workflow **pauses and waits for approval** from a required reviewer.
5. A reviewer approves the deployment in **Actions → Deploy to Production → Review deployments**.
6. The workflow downloads the build artifact and deploys to Vercel.
7. The deployment URL appears in the workflow summary.

### Manual Deployment

You can also trigger a deployment manually:

1. Go to **Actions → Deploy to Production**.
2. Click **Run workflow**.
3. Select the `main` branch.
4. Click **Run workflow**.
5. The workflow will still require approval before deploying.

> **Note**: Manual deployments rebuild from source since there is no CI artifact to download. They use the same production environment secrets.

### Concurrency Control

The workflow uses `concurrency: production-deploy` with `cancel-in-progress: false`. This means:

- Only one deployment can run at a time.
- If a new deployment is triggered while one is in progress, it **queues** (does not cancel the running one).
- This prevents race conditions and partial deployments.

---

## What Blocks a Deployment

| Condition                              | Result                                |
|----------------------------------------|---------------------------------------|
| CI fails (type check, lint, test, build) | Deployment workflow **does not trigger** |
| CI passes but reviewer rejects         | Deployment **does not proceed**       |
| Push to a non-`main` branch           | Deployment workflow **does not trigger** |
| PR opened (CI runs)                    | Deployment workflow **does not trigger** |
| Missing environment secrets            | Deploy step **fails with error**      |

---

## Troubleshooting

### Deployment workflow didn't trigger

- **Cause**: CI failed, so `workflow_run` with `conclusion: success` was not met.
- **Fix**: Check the CI run for failures and resolve them.

### "Waiting for review" state

- **Cause**: The `production` environment requires maintainer approval.
- **Fix**: A required reviewer must approve the deployment in the Actions UI.

### Artifact not found

- **Cause**: The build artifact name includes the commit SHA. If the CI run used a different SHA, the download will fail.
- **Fix**: Use manual `workflow_dispatch` to rebuild from source, or re-run the CI workflow.

### Vercel deployment fails

- **Cause**: Missing or incorrect `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID`.
- **Fix**: Verify the secrets are set in the `production` environment (not at repository level). Re-generate the Vercel token if expired.

### Environment secrets not available

- **Cause**: The workflow does not declare `environment: production`, or the environment name is misspelled.
- **Fix**: Ensure the workflow YAML contains `environment: name: production`.

---

## Related Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI pipeline — type check, lint, test, build, artifact upload |
| `.github/workflows/deploy-production.yml` | Gated production deployment workflow |
| `.github/workflows/codeql.yml` | Security analysis (unchanged) |
| `.github/workflows/sbom.yml` | SBOM generation (unchanged) |
| `vercel.json` | Vercel project configuration |
