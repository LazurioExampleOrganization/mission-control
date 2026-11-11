# Security

## Reporting

Report a vulnerability privately through GitHub's "Report a vulnerability"
on this repository. Do not open a public issue for it.

## What the App defends

- **Writes come only from the App itself.** Every writing API request must be
  `application/json` and carry an `Origin` of the App's own listener (loopback
  or the hosted origin Lazurio passes). A foreign `Host` is refused.
- **The App serves one data repository.** The sync host refuses a checkout
  whose configuration names another remote or branch, or whose real path lies
  outside the Module (`boundary_violation`).
- **No Git and no paths of its own on the data.** Records are read and written
  only through repository-db (`readDataFile`, `assertDataPath`,
  `writeRecordDraft`), which refuses symbolic links and paths outside the
  checkout. A save names the revision it was edited from; a stale save is
  refused.
- **Publishing is one validated commit.** repository-db runs the data
  repository's validator before every publish. Who may publish is decided by
  the person's live GitHub rights on the data repository; the App keeps no
  roster, token or key.
- **No secrets.** The App declares none, reads no `.env` file and stores no
  credential. Git transport uses the Environment's own sign-in.

## Out of scope

Authorization inside the App: anyone who can open the App in an Environment
can draft changes there. Access is decided by who may use the Environment and
by GitHub rights on the data repository.
