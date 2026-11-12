# Importing NBPRA into another environment

The solution zip is produced by `dataverse/export.mjs` from the development
environment. It is unmanaged and arrives with both test switches off.

## What the target environment needs first

- A Dataverse database.
- **Enable code apps** switched on (Power Platform admin centre → the environment →
  Settings → Product → Features), then Save.
- Power Apps Premium licences for the people who will use the apps.
- You, holding the System Administrator role there. The solution contains server
  code, which only an administrator can import.

## Import

1. Go to make.powerapps.com and pick the target environment (top right).
2. Solutions → Import solution → Browse → choose `NBPRA_1_0_0_0.zip` → Next → Import.
3. Wait for the banner that says the import finished. Open the NBPRA solution and
   check it lists the NBPRA Admin app and the NBPRA code app.

## After the import

1. **Roles.** Give Kate **NBPRA Administrator**, and everyone else who will use it
   **NBPRA User**. Each person also needs the environment's standard **Basic User**
   role. (Admin centre → the environment → Settings → Users → pick the user → Manage
   security roles.)
2. **Share the apps.** In make.powerapps.com → Apps, share **NBPRA** (the code app)
   with all users, and **NBPRA Admin** with Kate.
3. **Review groups.** Create one owner team per functional group (Legal, Tax, …)
   and add its members. (Admin centre → the environment → Settings → Teams.)
4. **Configuration**, in the NBPRA Admin app:
   - Committee calendar → Committees, then Meetings, then Slots. A meeting must have
     status Open and a request window that includes today for its slots to be
     requestable; each slot needs status Open and a capacity.
   - Configuration → Checklist templates: one template with status Published.
   - Sections for that template, then Questions for each section. A question that
     needs a file has answer type File; put the accepted extensions in its
     validation rule, for example `xlsx,xls`.
   - Review routes: for each section, one route per review team, marked active.
     A section with no route cannot be submitted.

## What is different from the development environment

- A person cannot decide or review their own submission.
- The five signatories must be five different people.
- There is no sample data. Nothing appears until the configuration above exists.

A full run-through therefore needs at least six accounts: a submitter, Kate, and
enough people to fill five signatory seats and the review teams.

## Not in this version

Notifications and Teams or email approvals, withdrawing a submission, reopening an
approved section, record-level security (every NBPRA user can read every
submission), and files larger than 5 MB.
