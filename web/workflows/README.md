To enable GitHub Pages deployment, copy `deploy-pages.yml` into the repo's
`.github/workflows/` directory (via PR or the web UI) and set
Settings → Pages → Source to **GitHub Actions**.

(Committed here because the repo's OAuth token lacks the `workflow` scope —
pushing files under `.github/workflows/` requires the owner to run
`gh auth refresh -s workflow` or upload this file via the web UI.)
