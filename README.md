# Hello World GitHub Pages App

A minimal static web app that you can host with GitHub Pages.

## Files

- `index.html`
- `styles.css`

## Run locally

Open `index.html` in your browser.

## Publish to GitHub Pages

1. Create a new GitHub repository (for example: `hello-world-pages`).
2. In this folder, run:

```bash
git init
git add .
git commit -m "Initial Hello World app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

3. In GitHub: **Repo → Settings → Pages**
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/ (root)`

4. Wait ~1 minute, then open:

`https://<your-username>.github.io/<your-repo>/`

## Optional custom domain

In **Settings → Pages**, add your custom domain and configure DNS records.
