# Deploying the Zone 5 Project Workload Tracker

About 15 minutes, all in the browser. Do this signed in with the GSA account that will own the app. That account must be able to open both source sheets:

- **WLT - BA61 Pipeline**: https://docs.google.com/spreadsheets/d/1Z0CNVnAft_h4dwJeket99PDwobLMC7YS2zUN55zNlAU
- **OFM Building Assignments**: https://docs.google.com/spreadsheets/d/1jH7ffxNrT2rFl2P0p-SFFH9z_yYcsH4W2qnBMB_xuAw

Open both links first. If either says you need access, request it before going on.

## 1. Create the Apps Script project

1. Go to https://script.google.com and click **New project**.
2. Click **Untitled project** at the top and name it **Zone 5 Project Workload Tracker**.
3. Click the gear (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.

## 2. Copy the files in

For each file in this repository's `webapp/` folder, make a file of the same name in the editor and paste its contents over whatever is there.

| In GitHub | In the editor |
|---|---|
| `Config.gs`, `Pipeline.gs`, `Data.gs`, `Api.gs`, `Setup.gs`, `Web.gs` | **+** › **Script**, type the name without `.gs` (rename the starting `Code.gs` to `Config`) |
| `Index.html`, `Styles.html`, `JsCore.html`, `JsApp.html` | **+** › **HTML**, type the name without `.html` |
| `appsscript.json` | already there; replace its contents |

To copy a file from GitHub: open it, click the **Copy raw file** button (two overlapping squares, top right of the file), then paste.

Click **Save** (the disk icon).

## 3. Run setup once

1. In the function list next to **Run**, pick **setup**, then click **Run**.
2. Google asks for permission: **Review permissions**, pick your account, **Advanced** › **Go to Zone 5 Project Workload Tracker**, **Allow**. The app asks only to *read* spreadsheets, to schedule its refresh, and to see the email of whoever opens it.
3. The log shows something like *"Set up: 874 Zone 5 PRs across 12 field offices … Refresh scheduled daily at 7:30 Central and every 4 hours."*

If it says it can't open a document, your account can't open one of the two sheets (see the top of this page).

## 4. Deploy the web app

1. **Deploy** › **New deployment**. Click the gear next to *Select type* and choose **Web app**.
2. Description: `Zone 5 Workload`.
3. **Execute as: Me**. Viewers then see the data through your access and don't need access to the sheets themselves.
4. **Who has access: Anyone within GSA** (your Google Workspace domain).
5. **Deploy**, then copy the **Web app URL**. That is the link to share.

## 5. Check it

Open the link. You should see the Overview for all of Zone 5, or your own office if you are one of its Field Office Managers. Try clicking a field office row, a stage bar, and a name on the Workload tab.

## Updating later

### By hand

Paste the changed files over the old ones, save, then **Deploy** › **Manage deployments** › pencil icon › **Version: New version** › **Deploy**. The link stays the same.

### Automatic updates from GitHub (optional)

`.github/workflows/apps-script.yml` runs the tests on every push and pull request. Once the settings below exist, each merge to `main` that changes `webapp/` is also uploaded to Apps Script and published on the same link.

1. In the Apps Script editor: **Project Settings** › copy the **Script ID**. Then **Deploy** › **Manage deployments** › copy the **Deployment ID** of the web app.
2. In GitHub: **Settings** › **Secrets and variables** › **Actions** › **Variables** tab › add `SCRIPT_ID` and `DEPLOYMENT_ID`.
3. Turn on the Apps Script API for your account at https://script.google.com/home/usersettings.
4. On any computer with Node: run `npx @google/clasp@2.4.2 login`, sign in, then open the file `~/.clasprc.json` it creates and copy all of it. In GitHub **Secrets** tab, add a secret named `CLASPRC_JSON` with that text. It is a sign-in token for your account: don't share it anywhere else.

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
