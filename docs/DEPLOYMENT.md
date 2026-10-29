# Deploying the Zone 5 Project Workload Tracker

About 15 minutes, all in the browser. Do this signed in with the GSA account that will own the app. That account must be able to open both source sheets:

- **WLT - BA61 Pipeline**: https://docs.google.com/spreadsheets/d/1Z0CNVnAft_h4dwJeket99PDwobLMC7YS2zUN55zNlAU
- **OFM Building Assignments**: https://docs.google.com/spreadsheets/d/1jH7ffxNrT2rFl2P0p-SFFH9z_yYcsH4W2qnBMB_xuAw

Open both links first. If either says you need access, request it before going on.

## 1. Create the Apps Script project

1. Go to https://script.google.com and click **New project**.
2. Click **Untitled project** at the top and name it **Zone 5 Project Workload Tracker**.
3. Click the gear (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.

## 2. Let GitHub upload the files

This is the same setup as the NEH BA61 dash: a GitHub workflow signs in to Google with a key you make once, uploads `webapp/`, and publishes it. Everything is done in the browser.

1. Turn the **Google Apps Script API** **On** at <https://script.google.com/home/usersettings>.
2. In the Apps Script editor, open **Project Settings** (gear) and copy the **Script ID**.
3. Make the sign-in key in **Google Cloud Shell** (<https://shell.cloud.google.com>, nothing to install):
   1. Run `npx --yes @google/clasp@2.4.2 login`.
   2. Open the link it prints, sign in with your GSA account and choose **Allow**.
   3. The browser then goes to a `http://localhost:…` page that doesn't load. Copy that whole address, open a second Cloud Shell tab (**+**), and run `curl '<the address>'`. The first tab says you're logged in.
   4. Run `cat ~/.clasprc.json` and copy everything it prints.

   Already made this key for the NEH BA61 dash with the same account and still have the text? You can reuse it. GitHub can't show a saved secret again, so if you don't have it, make a new one (the old one keeps working).
4. In GitHub, open this repo's **Settings › Secrets and variables › Actions › New repository secret**. Name it `CLASPRC_JSON`, paste the whole key, and click **Add secret**. Then in Cloud Shell run `npx @google/clasp@2.4.2 logout` (GitHub keeps its own copy).
5. In GitHub, open `.github/workflows/apps-script.yml`, click the pencil, put the Script ID between the quotes after `SCRIPT_ID:`, and **Commit changes** to `main`. (Or send the Script ID to Claude to do it.)
6. Open **Actions › Upload to Apps Script › Run workflow** (if committing the Script ID didn't already start it). When it shows a green check, reload the Apps Script editor: all the files are there.

## 3. Run setup once

1. In the function list next to **Run**, pick **setup**, then click **Run**.
2. Google asks for permission: **Review permissions**, pick your account, **Advanced** › **Go to Zone 5 Project Workload Tracker**, **Allow**. Google words the spreadsheet permission as "see, edit, create and delete" because opening a sheet by its ID needs it, but the tracker only reads the two sheets; it also asks to schedule its refresh, to see the email of whoever opens it, and to read the GSA directory (only to find each person's org code, so they open on their own field office).
3. The log shows something like *"Set up: 874 Zone 5 PRs across 12 field offices … Refresh scheduled daily at 7:30 Central and every 4 hours."*

If it says it can't open a document, your account can't open one of the two sheets (see the top of this page).

## 4. Deploy the web app

1. **Deploy** › **New deployment**. Click the gear next to *Select type* and choose **Web app**.
2. Description: `Zone 5 Workload`.
3. **Execute as: Me**. Viewers then see the data through your access and don't need access to the sheets themselves.
4. **Who has access: Anyone within GSA** (your Google Workspace domain).
5. **Deploy**, then copy the **Web app URL**. That is the link to share.
6. Open **Deploy › Manage deployments**, copy the **Deployment ID**, and put it between the quotes after `DEPLOYMENT_ID:` in `.github/workflows/apps-script.yml` (or send it to Claude). From then on every change merged to `main` is published on this same link.

## 5. Check it

Run **`checkDirectoryLookup`** in the editor (pick it next to **Run**). It logs the GSA directory display name it finds for you, the org code, and the office you'll open on, for example:

```
robert.sells@gsa.gov -> display name "Robert Sells - PMCGC", org code PMCGC, opens on Denver Federal Center Field Office
```

If it says "(not found)", the People API service is missing (in the editor, **Services +** › **People API** › **Add**) or GSA's directory isn't shared with the account. The tracker still works: Field Office Managers and Service Center Directors still open on their own office, and everyone else opens on the office where they lead the most projects, or on all of Zone 5.


Open the link. You should see the Overview for all of Zone 5, or your own office if you are one of its Field Office Managers. Try clicking a field office row, a stage bar, and a name on the Workload tab.

## Automatic updates from GitHub

The workflow in `.github/workflows/apps-script.yml` runs whenever a change to `webapp/` reaches `main`, for example when a pull request is merged. It:

1. runs the tests (`node dev/test.js`) and stops if any fail,
2. uploads every file in `webapp/` to the Apps Script project (the same as pasting each file and clicking **Save**; a file that's in Apps Script but not in `webapp/` is removed),
3. publishes a new version on the existing deployment, so the link stays the same.

Pull requests only run the tests. People see a change after a reload. Each run is listed under the repo's **Actions** tab, and **Run workflow** there starts one by hand (for example after fixing the sign-in).

The key belongs to the account that made it. If that person leaves, or uploads start failing with `invalid_grant` (the sign-in expired or was revoked), repeat steps 3–4 of section 2. Anyone who can change this repo's workflows can use the key, so keep write access to the repo limited.

If the repo is ever made private, nothing changes: the workflow runs inside GitHub with its own access.

## Settings

All optional, in **Project Settings** › **Script properties**:

- `ADMIN_EMAILS`: comma-separated emails that may press **Refresh** any time (everyone else: once every 10 minutes).
- `ZONE`: a different OFM zone number to track.
- `PIPELINE_ID`, `DIRECTORY_ID`: point at other copies of the two sheets.
- `CACHE_MINUTES`: how long a snapshot is reused (maximum 360).

## If something goes wrong

| What you see | What to do |
|---|---|
| "You do not have permission to access the requested document" | The deploying account lost access to one of the two sheets. Ask the sheet owner to share it again (viewer is enough). |
| "The pipeline report has no "Pipeline" tab" | The report's layout changed. Set `PIPELINE_TAB` to the new tab name. |
| Numbers look a day old | Press **Refresh**. If they are still old, open the pipeline sheet and check its *Report Info* › *Generated At*. The tracker can only be as fresh as the report. |
| An office or person is missing | Offices come from the OFM Building Assignments sheet, so a PR only shows up once its building is assigned to a Zone 5 office there. PRs with no building in EASi are matched only if a building number is in the title. |
