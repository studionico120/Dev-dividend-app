# How to add these files to GitHub

## Option A: GitHub web UI

1. Open the repository:
   https://github.com/studionico120/Dev-dividend-app

2. For each file in this package, create the same path in GitHub.
   For example:
   - `README.md`
   - `LICENSE`
   - `.env.example`
   - `.github/workflows/ci.yml`
   - `.github/ISSUE_TEMPLATE/bug_report.yml`

3. Paste the file content.

4. Commit directly to `main` or create a new branch and pull request.

Recommended commit message:

```text
Prepare repository for open-source contribution
```

## Option B: Local command line

Unzip this package, then copy the files into your local repository root.

```bash
cd Dev-dividend-app
cp -R /path/to/dev-dividend-app-oss-files/* .
cp -R /path/to/dev-dividend-app-oss-files/.github .
git status
git add README.md LICENSE CONTRIBUTING.md SECURITY.md CHANGELOG.md .env.example .github docs COPY_TO_GITHUB_INSTRUCTIONS.md
git commit -m "Prepare repository for open-source contribution"
git push origin main
```

## After committing

1. Go to the repository Settings / About area.
2. Set the description to:

```text
Local-first dividend portfolio tracker for Japanese and US stocks, built with Expo, React Native, and TypeScript.
```

3. Add topics:

```text
expo, react-native, typescript, dividend, portfolio-tracker, personal-finance, japanese-stocks, us-stocks, asyncstorage, open-source
```

4. Create the first release:
   - Tag: `v0.1.0`
   - Title: `v0.1.0 - Initial open-source documentation and CI setup`
   - Notes: use `docs/release-notes/v0.1.0.md`

5. Create a few starter issues:
   - Add tests for dividend calculation utilities
   - Add CSV import/export validation
   - Add screenshots to README
   - Add ESLint and Prettier
   - Document stock master CSV format
